import { Run } from '@prisma/client';

// TODO: scratch/local-runway passes pre-computed { job, run, initToken, initJobUrl } to
// the launcher instead of having each implementation generate env vars itself.
// Evaluate which approach is cleaner once all executor types are tested.
export interface ExecutorService {
  start(run: Run): Promise<void>;
}

// DI token — used in earthbeam.module.ts factory and consumers
export const EXECUTOR_SERVICE = 'ExecutorService';
