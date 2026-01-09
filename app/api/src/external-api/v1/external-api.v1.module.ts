import { Module } from '@nestjs/common';
import { JobsModule } from '../../jobs/jobs.module';
import { ExternalApiV1JobsController } from './jobs.v1.controller';
import { ExternalApiAuthService } from '../auth/external-api.auth.service';
import { AppConfigModule } from '../../config/app-config.module';
import { ExternalApiV1TokenController } from './token.v1.controller';

@Module({
  imports: [JobsModule, AppConfigModule],
  providers: [ExternalApiAuthService],
  controllers: [ExternalApiV1JobsController, ExternalApiV1TokenController],
  exports: [],
})
export class ExternalApiV1Module {}
