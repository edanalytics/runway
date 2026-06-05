import { Module } from '@nestjs/common';
import { PartnerSyncService } from './partner-sync.service';

@Module({
  providers: [PartnerSyncService],
})
export class PartnerSyncModule {}
