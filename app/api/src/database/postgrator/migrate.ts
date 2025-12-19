import { Logger } from '@nestjs/common';
import { join } from 'path';
import pg from 'pg';
import type PostgratorConstructor from 'postgrator';

const logger = new Logger('Postgrator');

export const migrate = async (pgClient: pg.Pool, dbName: string) => {
  try {
    await pgClient.connect();
    // this ugly eval hack is needed to prevent webpack from turning
    // import into require, because postgrator is esm
    const Pg = (await new Function('path', 'return import(path)')('postgrator'))
      .default as typeof PostgratorConstructor;

    const postgrator = new Pg({
      migrationPattern: join(__dirname, '/../../api/src/database/postgrator/migrations/*'),
      driver: 'pg',
      database: dbName,
      schemaTable: 'schemaversion',
      execQuery: (query) => pgClient.query(query),
    });

    logger.log(`Found ${(await postgrator.getMigrations()).length} migrations.`);

    const appliedMigrations = await postgrator.migrate();
    logger.log(`Ran ${appliedMigrations.length} migrations:`, appliedMigrations);
  } catch (error: any) {
    logger.error(error, error?.appliedMigrations);
    throw new Error('Migrations failed to run. Crashing app...');
  }
  return;
};
