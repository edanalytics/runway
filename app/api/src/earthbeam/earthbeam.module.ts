import { Module } from '@nestjs/common';
import { EarthbeamBundlesService } from './earthbeam-bundles.service';
import { EarthbeamApiAuthModule } from './api/auth/earthbeam-api-auth.module';
import { ExecutorService } from './executor/executor.abstract.service';
import { AppConfigService } from '../config/app-config.service';
import { EarthbeamApiAuthService } from './api/auth/earthbeam-api-auth.service';
import { ExecutorAwsService } from './executor/executor.aws.service';
import { ExecutorLocalPythonService } from './executor/executor.local-python.service';
import { ExecutorLocalDockerService } from './executor/executor.local-docker.service';

@Module({
  // TODO: does this module make sense??? Maybe this is really some sort of peripherals module
  // and they get injected differently based on local vs deployed?
  imports: [EarthbeamApiAuthModule],
  providers: [
    EarthbeamBundlesService,
    {
      provide: ExecutorService,
      inject: [AppConfigService, EarthbeamApiAuthService],
      useFactory: (appConfig: AppConfigService, apiAuth: EarthbeamApiAuthService) => {
        if (appConfig.get('LOCAL_EXECUTOR') === 'python') {
          return new ExecutorLocalPythonService(appConfig, apiAuth);
        }
        if (appConfig.get('LOCAL_EXECUTOR') === 'docker') {
          return new ExecutorLocalDockerService(appConfig, apiAuth);
        } else {
          return new ExecutorAwsService(appConfig, apiAuth);
        }
      },
    },
  ],
  exports: [EarthbeamBundlesService, ExecutorService],
})
export class EarthbeamModule {}
