import { Module } from '@nestjs/common';
import { APP_GUARD, RouterModule } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { AuthenticatedGuard } from '../auth/login/authenticated.guard';
import { UsersModule } from '../users/users.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { routes } from './routes';
import { ServicesModule } from './services.module';
import { OdsConfigModule } from '../ods-config/ods-config.module';
import { SchoolYearsModule } from '../school-year/school-years.module';
import { JobTemplatesModule } from '../job-templates/job-templates.module';
import { JobsModule } from '../jobs/jobs.module';
import { EarthbeamApiModule } from '../earthbeam/api/earthbeam-api.module';
import { EarthbeamApiAuthModule } from '../earthbeam/api/auth/earthbeam-api-auth.module';
import { ExternalApiV1Module } from '../external-api/v1/external-api.v1.module';
import { AuthorizedGuard } from '../auth/login/authorized.guard';
import { PartnersModule } from '../partners/partners.module';

const resourceModules = [
  UsersModule,
  OdsConfigModule,
  JobsModule,
  JobTemplatesModule,
  SchoolYearsModule,
  EarthbeamApiModule,
  EarthbeamApiAuthModule,
  PartnersModule,
];

@Module({
  imports: [
    ServicesModule,
    RouterModule.register(routes),
    AuthModule,
    ...resourceModules,
    ExternalApiV1Module,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AuthenticatedGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthorizedGuard,
    },
  ],
})
export class AppModule {}
