import { Logger, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Prisma, PrismaClient } from '@prisma/client';
import { Request } from 'express';
import pg from 'pg';
import { AppConfigService } from '../config/app-config.service';
import { CustomServerErrorException } from '../utils/custom-exceptions';

const logger = new Logger('PrismaProvider');

export const provideDatabaseService = {
  inject: [AppConfigService],
  provide: 'DatabaseService',
  useFactory: async (appConfigService: AppConfigService) => {
    const pgConfig = await appConfigService.postgresPoolConfig();
    return new pg.Pool(pgConfig);
  },
};

/**
 * Read-only Prisma client. Does not require an authenticated user because it
 * doesn't write audit logs, which allows it the advantage of not being
 * request-scoped (good for performance). If you require write access not
 * pertaining to an authenticated request use
 * {@link PRISMA_ANONYMOUS}.
 */
export const PRISMA_READ_ONLY = 'PrismaReadonly';
/**
 * Prisma client to be used for queries not made during an authenticated request
 * (appears in the audit log with `userId=-1` and `userUsername=APP`). The
 * {@link PRISMA_READ_ONLY} is also anonymous &mdash; it exists separately from
 * this one (with its read-only restriction) in order to support the convention
 * of ___always using the {@link PRISMA_APP_USER} client for writes, where
 * possible___. To avoid mistaken usage of this one instead of that one, this
 * should not be injected into any authenticated request context.
 */
export const PRISMA_ANONYMOUS = 'PrismaAnon';
/**
 * Prisma client which attaches the app user to the SQL audit log.
 *
 * ___Warning:__
 * this service is request-scoped, which causes a (slight) performance hit
 * because it causes any dependent of it to also be request scoped (e.g.
 * controllers). For that reason, don't use it in any services that don't need
 * to do any writes (use {@link PRISMA_READ_ONLY} instead)._
 */
export const PRISMA_APP_USER = 'PrismaAppUser';

export const providePrismaReadonly = {
  inject: [PRISMA_ANONYMOUS],
  provide: PRISMA_READ_ONLY,
  useFactory: async (prismaAnon: PrismaClient) => {
    const WRITE_METHODS = [
      'create',
      'update',
      'upsert',
      'delete',
      'createMany',
      'updateMany',
      'deleteMany',
    ] as const;

    const readonlyClientExt = Prisma.defineExtension({
      name: 'ReadonlyClient',
      model: {
        $allModels: Object.fromEntries(
          WRITE_METHODS.map((method) => [
            method,
            function () {
              throw new Error(
                `Calling the \`${method}\` method on a readonly client is not allowed`
              );
            },
          ])
        ) as any,
      },
    });
    return prismaAnon.$extends(readonlyClientExt);
  },
};

export const providePrismaWrite = {
  scope: Scope.REQUEST,
  inject: [PRISMA_ANONYMOUS, REQUEST],
  provide: PRISMA_APP_USER,
  useFactory: async (prismaAnon: PrismaClient, request: Request): Promise<PrismaClient> => {
    let extendedClient: PrismaClient;

    if ('user' in request && request.user) {
      const session = request.user;
      const addUserContextExt = Prisma.defineExtension((prisma) =>
        prisma.$extends({
          query: {
            async $allOperations({ args, query }) {
              const [, result] = await prisma.$transaction([
                prisma.$executeRaw`
                  SELECT
                    set_config('app.current_user_id', ${String(session.user.id)}, true),
                    set_config('app.current_user_username', ${session.user.email}, true)`,
                query(args),
              ]);
              return result;
            },
          },
        })
      );
      extendedClient = prismaAnon.$extends(addUserContextExt) as PrismaClient;
    } else {
      const disallowAnonymousWritesExt = Prisma.defineExtension((prisma) =>
        prisma.$extends({
          query: {
            $allModels: {
              $allOperations() {
                logger.error(
                  'DB interaction misconfigured to use authenticated client in public route.'
                );
                throw new CustomServerErrorException('Trouble connecting to the database');
              },
            },
          },
        })
      );
      extendedClient = prismaAnon.$extends(disallowAnonymousWritesExt) as PrismaClient;
    }
    return extendedClient;
  },
};
// Full list from node_modules/@prisma/client/runtime/library.d.ts   #ModelAction
const editOperations = new Set([
  // "findUnique",
  // "findUniqueOrThrow",
  // "findFirst",
  // "findFirstOrThrow",
  // "findMany",
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  // "delete",
  // "deleteMany",
  // "groupBy",
  // "count",
  // "aggregate",
  // "findRaw",
  // "aggregateRaw"
]);
const sqlHandledFields = ['created', 'modified', 'createdById', 'modifiedById'];
export const providePrismaAnon = {
  inject: [AppConfigService],
  provide: PRISMA_ANONYMOUS,
  useFactory: async (appConfigService: AppConfigService) => {
    const { database, host, port, password, user, ssl } =
      await appConfigService.postgresPoolConfig();
    const client = new PrismaClient({
      datasourceUrl: `postgres://${user}:${password}@${host}:${port}/${database}?sslmode=${
        ssl ? 'require' : 'disable'
      }`,
    });

    await client.$executeRaw`
      SELECT
        set_config('app.current_user_id', '-1', false),
        set_config('app.current_user_username', 'APP', false)
    `;
    const addUserContextExt = Prisma.defineExtension((prisma) =>
      prisma.$extends({
        query: {
          $allModels: {
            $allOperations({ operation, args, query }) {
              if (editOperations.has(operation)) {
                sqlHandledFields.forEach((fieldName) => {
                  if (fieldName in (args as any).data) {
                    delete (args as any).data[fieldName];
                  }
                });
              }
              return query(args);
            },
          },
        },
      })
    );
    const extendedClient = client.$extends(addUserContextExt) as PrismaClient;
    return extendedClient;
  },
};
