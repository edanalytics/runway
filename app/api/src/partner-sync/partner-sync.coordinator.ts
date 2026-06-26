import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { AppConfigService } from '../config/app-config.service';
import { TxSyncHandler } from './tx/tx-sync.handler';
import { UmSyncHandler } from './user-management/um-sync.handler';

@Injectable()
export class PartnerSyncCoordinator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PartnerSyncCoordinator.name);
  private boss: PgBoss | null = null;

  constructor(
  private readonly appConfig: AppConfigService,
  private readonly umHandler: UmSyncHandler,
  private readonly txHandler: TxSyncHandler,  ) {}

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

    for (const handler of [this.umHandler, this.txHandler]) {
      const source = handler.sourceKey;
      const config = this.appConfig.getSyncConfig(source);
      if (!config) {
        this.logger.warn(`${source} config not set — unscheduling any existing job`);
        await this.boss.unschedule(handler.sourceKey);
        continue;
      }

      await this.boss.createQueue(handler.sourceKey);
      await this.boss.schedule(handler.sourceKey, config.syncCron, null, {
        singletonKey: source,
      });
      await this.boss.work(handler.sourceKey, () => handler.sync());
      this.logger.log(`${source} sync scheduled: ${config.syncCron}`);
    }
  }
}
