import { IdrsReadinessService } from './idrs-readiness.service';
import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { IdrsCredentialsService } from './idrs-credentials.service';
import { IdrsSearchService } from './idrs-search.service';

@Module({
  imports: [AppConfigModule],
  providers: [IdrsCredentialsService, IdrsSearchService, IdrsReadinessService],
  exports: [IdrsCredentialsService, IdrsSearchService, IdrsReadinessService],
})
export class IdrsModule {}
