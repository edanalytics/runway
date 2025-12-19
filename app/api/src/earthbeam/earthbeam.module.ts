import { Module } from '@nestjs/common';
import { EarthbeamBundlesService } from './earthbeam-bundles.service';
import { EarthbeamApiAuthModule } from './api/auth/earthbeam-api-auth.module';
import { EarthbeamRunService } from './earthbeam-run.service';

@Module({
  imports: [EarthbeamApiAuthModule],
  providers: [EarthbeamBundlesService, EarthbeamRunService],
  exports: [EarthbeamBundlesService, EarthbeamRunService],
})
export class EarthbeamModule {}
