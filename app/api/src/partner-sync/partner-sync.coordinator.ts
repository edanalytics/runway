import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PRISMA_ANONYMOUS } from '../database/database.service';
import { SyncHandler, SYNC_HANDLERS } from './sync-handler.interface';

@Injectable()
export class PartnerSyncCoordinator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PartnerSyncCoordinator.name);
  private boss: PgBoss | null = null;

  constructor(
    private readonly appConfig: AppConfigService,
    @Inject(PRISMA_ANONYMOUS) private readonly prisma: PrismaClient,
    @Inject(SYNC_HANDLERS) private readonly handlers: SyncHandler[]
  ) {}

  async onModuleDestroy() {
    await this.boss?.stop();
  }

  async onModuleInit() {
    const pgConfig = await this.appConfig.postgresPoolConfig();
    const { user, password, host, database, port, ssl } = pgConfig;
    const sslMode = ssl ? 'require' : 'disable';
    const connStr = `postgres://${user}:${encodeURIComponent(String(password))}@${
      host ?? 'localhost'
    }:${port ?? 5432}/${database}?sslmode=${sslMode}`;

    this.boss = new PgBoss(connStr);
    await this.boss.start();

    const partners = await this.prisma.partner.findMany({
      where: { managedBy: { not: null } },
      select: { managedBy: true },
    });

    const activeSources = new Set(
      partners.flatMap((p) => (p.managedBy ? [p.managedBy] : []))
    );

    const handlersBySource = new Map(this.handlers.map((h) => [h.sourceKey, h]));

    for (const source of activeSources) {
      const handler = handlersBySource.get(source);
      if (!handler) {
        this.logger.warn(`Sync source "${source}" has no registered handler — skipping`);
        continue;
      }

      const config = this.appConfig.getSyncConfig(source);
      if (!config) {
        this.logger.warn(`${source} config not set — unscheduling any existing job`);
        await this.boss.unschedule(handler.channel);
        continue;
      }

      await this.boss.createQueue(handler.channel);
      await this.boss.schedule(handler.channel, config.syncCron, null, {
        singletonKey: source,
      });
      await this.boss.work(handler.channel, () => handler.sync());
      this.logger.log(`${source} sync scheduled: ${config.syncCron}`);
    }
  }
}
