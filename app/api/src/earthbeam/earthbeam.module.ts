import { Module } from '@nestjs/common';
import { EarthbeamBundlesService } from './earthbeam-bundles.service';
import { EarthbeamApiAuthModule } from './api/auth/earthbeam-api-auth.module';
import { EXECUTOR_SERVICE } from './executor/executor.service';
import { AppConfigService } from '../config/app-config.service';
import { EarthbeamApiAuthService } from './api/auth/earthbeam-api-auth.service';
import { ExecutorAwsService } from './executor/executor.aws.service';
import { ExecutorLocalPythonService } from './executor/executor.local-python.service';
import { ExecutorLocalDockerService } from './executor/executor.local-docker.service';

@Module({
  imports: [EarthbeamApiAuthModule],
  providers: [
    EarthbeamBundlesService,
    {
      provide: EXECUTOR_SERVICE,
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
  exports: [EarthbeamBundlesService, EXECUTOR_SERVICE],
})
export class EarthbeamModule {}
