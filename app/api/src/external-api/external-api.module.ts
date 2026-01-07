import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ExternalApiJobsV1Controller } from './v1/external-jobs-v1.controller';
import { ExternalApiAuthService } from './external-api.auth.service';
import { AppConfigModule } from '../config/app-config.module';

@Module({
  imports: [JobsModule, AppConfigModule],
  providers: [ExternalApiAuthService],
  controllers: [ExternalApiJobsV1Controller],
  exports: [],
})
export class ExternalApiModule {}
