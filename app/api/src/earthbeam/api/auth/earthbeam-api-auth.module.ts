import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EncryptionModule } from 'api/src/encryption/encryption.module';
import { AppConfigModule } from 'api/src/config/app-config.module';
import { AppConfigService } from 'api/src/config/app-config.service';
import { EarthbeamApiAuthService } from './earthbeam-api-auth.service';
import { EarthbeamApiAuthController } from './earthbeam-api-auth.controller';

@Module({
  imports: [
    EncryptionModule,
    AppConfigModule,
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: async (configService: AppConfigService) => ({
        secret: await configService.getJwtKey(),
      }),
    }),
  ],
  providers: [EarthbeamApiAuthService],
  controllers: [EarthbeamApiAuthController],
  exports: [EarthbeamApiAuthService],
})
export class EarthbeamApiAuthModule {}
