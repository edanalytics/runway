import { Run } from '@prisma/client';
import { AppConfigService } from 'api/src/config/app-config.service';
import { EarthbeamApiAuthService } from '../api/auth/earthbeam-api-auth.service';

// TODO: scratch/local-runway passes pre-computed { job, run, initToken, initJobUrl } to
// the launcher instead of having each implementation generate env vars itself.
// Evaluate which approach is cleaner once all executor types are tested.
export interface ExecutorService {
  start(run: Run): Promise<void>;
}

// Shared env vars needed by all executor runtimes. Each implementation calls this
// and supplements with any additional env vars its runtime needs.
export async function executorEnvVars(
  runId: number,
  apiAuth: EarthbeamApiAuthService,
  appConfig: AppConfigService
): Promise<Record<string, string>> {
  return {
    INIT_TOKEN: await apiAuth.createInitToken({ runId }),
    INIT_JOB_URL: apiAuth.initEndpoint({ runId }),
    TIMEOUT_SECONDS: appConfig.get('TIMEOUT_SECONDS') ?? '3600',
  };
}

// DI token — used in earthbeam.module.ts factory and consumers
export const EXECUTOR_SERVICE = 'ExecutorService';
