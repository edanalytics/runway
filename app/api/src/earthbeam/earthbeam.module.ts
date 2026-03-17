import { Logger, Module } from '@nestjs/common';
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
        const localExecutor = appConfig.get('LOCAL_EXECUTOR');
        if (localExecutor && !appConfig.isDevEnvironment()) {
          new Logger('EarthbeamModule').warn(
            `LOCAL_EXECUTOR=${localExecutor} is set but NODE_ENV is not "development"`
          );
        }
        if (localExecutor === 'python') {
          return new ExecutorLocalPythonService(appConfig, apiAuth);
        }
        if (localExecutor === 'docker') {
          return new ExecutorLocalDockerService(appConfig, apiAuth);
        }
        return new ExecutorAwsService(appConfig, apiAuth);
      },
    },
  ],
  exports: [EarthbeamBundlesService, EXECUTOR_SERVICE],
})
export class EarthbeamModule {}
