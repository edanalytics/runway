import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private _boss: PgBoss | undefined;
  private readonly _ready: Promise<PgBoss>;

  constructor(private readonly appConfig: AppConfigService) {
    this._ready = this.init();
  }

  // Resolves once the underlying PgBoss instance has started (migrations run, ready for DB access).
  get boss(): Promise<PgBoss> {
    return this._ready;
  }

  private async init(): Promise<PgBoss> {
    const pgConfig = await this.appConfig.postgresPoolConfig();
    this._boss = new PgBoss(pgConfig);
    await this._boss.start();
    return this._boss;
  }

  async onModuleInit() {
    await this._ready;
  }

  async onModuleDestroy() {
    await this._boss?.stop();
  }
}
