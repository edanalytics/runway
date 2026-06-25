import { Module } from '@nestjs/common';
import { PartnerSyncCoordinator } from './partner-sync.coordinator';
import { AlSyncHandler } from './user-management/um-sync.handler';
import { TxSyncHandler } from './tx/tx-sync.handler';
import { SYNC_HANDLERS } from './sync-handler.interface';

@Module({
  providers: [
    AlSyncHandler,
    TxSyncHandler,
    {
      provide: SYNC_HANDLERS,
      useFactory: (al: AlSyncHandler, tx: TxSyncHandler) => [al, tx],
      inject: [AlSyncHandler, TxSyncHandler],
    },
    PartnerSyncCoordinator,
  ],
})
export class PartnerSyncModule {}
