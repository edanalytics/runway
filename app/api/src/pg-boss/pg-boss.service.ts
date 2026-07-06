import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private _boss: PgBoss | undefined;

  constructor(private readonly appConfig: AppConfigService) {}

  get boss(): PgBoss {
    if (!this._boss) {
      throw new Error('PgBossService.boss accessed before initialization');
    }
    return this._boss;
  }

  async onModuleInit() {
    const pgConfig = await this.appConfig.postgresPoolConfig();
    this._boss = new PgBoss(pgConfig);
    await this._boss.start();
  }

  async onModuleDestroy() {
    await this._boss?.stop();
  }
}
