import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  private _boss: PgBoss | undefined;
  private _ready: Promise<PgBoss> | undefined;

  constructor(private readonly appConfig: AppConfigService) {}

  // Resolves once the underlying PgBoss instance has started (migrations run, ready for DB access).
  get boss(): Promise<PgBoss> {
    this._ready ??= this.init()
    return this._ready;
  }

  private async init(): Promise<PgBoss> {
    const pgConfig = await this.appConfig.postgresPoolConfig();
    this._boss = new PgBoss(pgConfig);
    return this._boss.start();
  }

  async onModuleInit() {
    this._ready ??= this.init()
    await this._ready;
  }

  async onModuleDestroy() {
    await this._boss?.stop();
  }
}
