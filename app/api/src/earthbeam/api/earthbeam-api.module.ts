import { Module } from '@nestjs/common';
import { EarthbeamApiController } from './earthbeam-api.controller';
import { JobsModule } from 'api/src/jobs/jobs.module';
import { EncryptionModule } from 'api/src/encryption/encryption.module';
import { AppConfigModule } from 'api/src/config/app-config.module';
import { EarthbeamApiAuthModule } from './auth/earthbeam-api-auth.module';
import { EarthbeamApiService } from './earthbeam-api.service';
import { EduSnowflakePoolService } from './edu-snowflake-pool.service';
import { StudentMatchResultsService } from './student-match-results.service';
import { FileModule } from 'api/src/files/file.module';
import { EventEmitterModule } from 'api/src/event-emitter/event-emitter.module';
import { IdrsModule } from '../../idrs/idrs.module';
import { EarthbeamModule } from '../earthbeam.module';

@Module({
  imports: [
    EarthbeamApiAuthModule,
    JobsModule,
    EncryptionModule,
    AppConfigModule,
    FileModule,
    EventEmitterModule,
    IdrsModule,
    EarthbeamModule,
  ],
  providers: [
    EarthbeamApiService,
    EduSnowflakePoolService,
    StudentMatchResultsService,
  ],
  controllers: [EarthbeamApiController],
  exports: [EduSnowflakePoolService],
})
export class EarthbeamApiModule {}
