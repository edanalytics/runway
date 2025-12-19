import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EarthbeamApiController } from './earthbeam-api.controller';
import { JobsModule } from 'api/src/jobs/jobs.module';
import { EncryptionModule } from 'api/src/encryption/encryption.module';
import { AppConfigModule } from 'api/src/config/app-config.module';
import { AppConfigService } from 'api/src/config/app-config.service';
import { EarthbeamApiAuthModule } from './auth/earthbeam-api-auth.module';
import { EarthbeamApiService } from './earthbeam-api.service';
import { FileModule } from 'api/src/files/file.module';
import { EventEmitterModule } from 'api/src/event-emitter/event-emitter.module';

@Module({
  imports: [
    EarthbeamApiAuthModule,
    JobsModule,
    EncryptionModule,
    AppConfigModule,
    FileModule,
    EventEmitterModule,
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: async (configService: AppConfigService) => ({
        secret: await configService.getJwtKey(),
      }),
    }),
  ],
  providers: [EarthbeamApiService],
  controllers: [EarthbeamApiController],
  exports: [],
})
export class EarthbeamApiModule {}
