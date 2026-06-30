import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class PgBossService implements OnModuleInit, OnModuleDestroy {
  boss!: PgBoss;

  constructor(private readonly appConfig: AppConfigService) {}

  async onModuleInit() {
    const pgConfig = await this.appConfig.postgresPoolConfig();
    const { user, password, host, database, port, ssl } = pgConfig;
    const sslMode = ssl ? 'require' : 'disable';
    const connStr = `postgres://${user}:${encodeURIComponent(String(password))}@${
      host ?? 'localhost'
    }:${port ?? 5432}/${database}?sslmode=${sslMode}`;

    this.boss = new PgBoss(connStr);
    await this.boss.start();
  }

  async onModuleDestroy() {
    await this.boss?.stop();
  }
}
