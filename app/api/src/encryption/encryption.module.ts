import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';

@Module({
  imports: [AppConfigModule],
  providers: [EncryptionService, AppConfigService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
