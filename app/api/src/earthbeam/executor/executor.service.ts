import { Run } from '@prisma/client';

export interface ExecutorService {
  start(run: Run): Promise<void>;
}

// DI token — used in earthbeam.module.ts factory and consumers
export const EXECUTOR_SERVICE = 'ExecutorService';
