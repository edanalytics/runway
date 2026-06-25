import { Module } from '@nestjs/common';
import { PartnerSyncCoordinator } from './partner-sync.coordinator';
import { UmSyncHandler } from './user-management/um-sync.handler';
import { TxSyncHandler } from './tx/tx-sync.handler';
import { SYNC_HANDLERS } from './sync-handler.interface';

@Module({
  providers: [
    UmSyncHandler,
    TxSyncHandler,
    {
      provide: SYNC_HANDLERS,
      useFactory: (al: UmSyncHandler, tx: TxSyncHandler) => [al, tx],
      inject: [UmSyncHandler, TxSyncHandler],
    },
    PartnerSyncCoordinator,
  ],
})
export class PartnerSyncModule {}
