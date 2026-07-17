import { Logger, Module } from '@nestjs/common';
import { EarthbeamBundlesService } from './earthbeam-bundles.service';
import { EarthbeamApiAuthModule } from './api/auth/earthbeam-api-auth.module';
import { EXECUTOR_SERVICE } from './executor/executor.service';
import { AppConfigService } from '../config/app-config.service';
import { EarthbeamApiAuthService } from './api/auth/earthbeam-api-auth.service';
import { ExecutorAwsService } from './executor/executor.aws.service';
import { ExecutorLocalPythonService } from './executor/executor.local-python.service';
import { ExecutorLocalDockerService } from './executor/executor.local-docker.service';
import { FileModule } from '../files/file.module';
import { FileService } from '../files/file.service';

@Module({
  imports: [EarthbeamApiAuthModule, FileModule],
  providers: [
    EarthbeamBundlesService,
    {
      provide: EXECUTOR_SERVICE,
      inject: [AppConfigService, EarthbeamApiAuthService, FileService],
      useFactory: (
        appConfig: AppConfigService,
        apiAuth: EarthbeamApiAuthService,
        fileService: FileService
      ) => {
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
        return new ExecutorAwsService(appConfig, apiAuth, fileService);
      },
    },
  ],
  exports: [EarthbeamBundlesService, EXECUTOR_SERVICE],
})
export class EarthbeamModule {}
