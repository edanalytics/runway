import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  boss: PgBoss;

  constructor(private readonly appConfig: AppConfigService) {}

  async onModuleInit() {
    const pgConfig = await this.appConfig.postgresPoolConfig();
    this.boss = new PgBoss(pgConfig);
    await this.boss.start();
  }

  async onModuleDestroy() {
    await this.boss?.stop();
  }
}
