import { Module } from '@nestjs/common';
import { PartnerSyncCoordinator } from './partner-sync.coordinator';
import { UmSyncHandler } from './user-management/um-sync.handler';
import { TxSyncHandler } from './tx/tx-sync.handler';

@Module({
  providers: [
    UmSyncHandler,
    TxSyncHandler,
    PartnerSyncCoordinator,
  ],
})
export class PartnerSyncModule {}
