import { Routes } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { OdsConfigModule } from '../ods-config/ods-config.module';
import { SchoolYearsModule } from '../school-year/school-years.module';
import { JobsModule } from '../jobs/jobs.module';
import { JobTemplatesModule } from '../job-templates/job-templates.module';
import { EarthbeamApiModule } from '../earthbeam/api/earthbeam-api.module';
import { EarthbeamApiAuthModule } from '../earthbeam/api/auth/earthbeam-api-auth.module';
import {
  EARTHBEAM_AUTH_BASE_ROUTE,
  EARTHBEAM_API_BASE_ROUTE,
} from '../earthbeam/api/earthbeam-api.endpoints';
import { ExternalApiModule } from '../external-api/external-api.module';

export const routes: Routes = [
  {
    path: 'users',
    module: UsersModule,
  },
  {
    path: 'ods-configs',
    module: OdsConfigModule,
  },
  {
    path: 'jobs',
    module: JobsModule,
  },
  {
    path: 'job-templates',
    module: JobTemplatesModule,
  },
  {
    path: 'school-years',
    module: SchoolYearsModule,
  },
  {
    path: EARTHBEAM_API_BASE_ROUTE,
    module: EarthbeamApiModule,
  },
  {
    path: EARTHBEAM_AUTH_BASE_ROUTE,
    module: EarthbeamApiAuthModule,
  },
  {
    path: 'v1',
    module: ExternalApiModule,
  },
];
