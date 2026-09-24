import { EcsTaskSize, Job, JobFile, Run, SchoolYear } from '@prisma/client';

// What the caller should record on the run about where it executed. Null for
// executors that don't launch an ECS task (the local ones).
export type ExecutorStartResult = {
  ecsTaskArn: string | null;
  taskSize: EcsTaskSize | null;
};

export interface ExecutorService {
  start: (
    run: Run & { job: Job & { schoolYear: SchoolYear; files: JobFile[] } }
  ) => Promise<ExecutorStartResult>;
}

// DI token — used in earthbeam.module.ts factory and consumers
export const EXECUTOR_SERVICE = 'ExecutorService';
