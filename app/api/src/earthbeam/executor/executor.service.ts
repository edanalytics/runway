import { Job, Run, SchoolYear } from '@prisma/client';

export interface ExecutorService {
  start: (run: Run & { job: Job & { schoolYear: SchoolYear } }) => Promise<void>;
}

// DI token — used in earthbeam.module.ts factory and consumers
export const EXECUTOR_SERVICE = 'ExecutorService';
