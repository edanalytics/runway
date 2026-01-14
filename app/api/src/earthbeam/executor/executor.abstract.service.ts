import { Job, Run } from '@prisma/client';
import { AppConfigService } from 'api/src/config/app-config.service';
import { EarthbeamApiAuthService } from '../api/auth/earthbeam-api-auth.service';

export abstract class ExecutorService {
  constructor(
    protected readonly appConfig: AppConfigService,
    protected readonly apiAuth: EarthbeamApiAuthService
  ) {}

  abstract start(run: Run): Promise<void>;

  // These env vars are shared by all methods of running the executor. It's up to
  // subclasses to supplement these with any additional env vars their runtime needs.
  async envVars(runId: number): Promise<Record<string, string>> {
    return {
      INIT_TOKEN: await this.apiAuth.createInitToken({ runId }),
      INIT_JOB_URL: this.apiAuth.initEndpoint({ runId }),
      TIMEOUT_SECONDS: this.appConfig.get('TIMEOUT_SECONDS') ?? '3600',
    };
  }
}
