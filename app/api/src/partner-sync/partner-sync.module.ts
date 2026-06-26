import { Module } from '@nestjs/common';
import { PartnerSyncCoordinator } from './partner-sync.coordinator';
import { UmSyncHandler } from './user-management/um-sync.handler';

@Module({
  providers: [
    UmSyncHandler,
    PartnerSyncCoordinator,
  ],
})
export class PartnerSyncModule {}
