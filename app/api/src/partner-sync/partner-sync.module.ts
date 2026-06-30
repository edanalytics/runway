import { Module } from '@nestjs/common';
import { PgBossService } from './pg-boss.service';
import { UmSyncHandler } from './user-management/um-sync.handler';

@Module({
  providers: [
    PgBossService,
    UmSyncHandler,
  ],
})
export class PartnerSyncModule {}
