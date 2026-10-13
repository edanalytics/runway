import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { IdrsCredentialsService } from './idrs-credentials.service';

@Module({
  imports: [AppConfigModule],
  providers: [IdrsCredentialsService],
  exports: [IdrsCredentialsService],
})
export class IdrsModule {}
