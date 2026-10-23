import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  ExecutorService,
  ExecutorStartResult,
  EXECUTOR_SERVICE,
} from '../earthbeam/executor/executor.service';

/** Launches runs on the Executor this environment uses. */
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);
  constructor(@Inject(EXECUTOR_SERVICE) private executor: ExecutorService) {}

  /**
   * Starts the Executor on a run that's already committed, since the Executor
   * reads the run back from another connection. A failure to start leaves the
   * run done, in error, unless its task has initialized anyway.
   */
  async launch(
    run: Parameters<ExecutorService['start']>[0],
    prisma: PrismaClient
  ): Promise<{ status: 'SUCCESS' } | { status: 'ERROR'; code: 'failed_to_start_executor' }> {
    let startResult: ExecutorStartResult;
    try {
      startResult = await this.executor.start(run);
    } catch (e) {
      this.logger.error(`Failed to start run ${run.id}: ${e}`);

      const failed = await prisma.$transaction(async (tx) => {
        // Only from `new`: ECS can report a failure after accepting the task,
        // and if the task has initialized, the run is executing and will
        // report its own `done`. A run's status is never overwritten.
        const { count } = await tx.run.updateMany({
          where: { id: run.id, status: 'new' },
          data: { status: 'error' },
        });
        if (count === 0) {
          return false;
        }
        await tx.runError.create({
          data: {
            runId: run.id,
            code: 'failed_to_start_executor',
            payload: { stacktrace: 'stacktrace unavailable' },
          },
        });
        await tx.runUpdate.create({ data: { runId: run.id, action: 'done', status: 'failure' } });
        return true;
      });
      if (!failed) {
        this.logger.warn(
          `Run ${run.id} initialized though its launch failed; treating it as started`
        );
        return { status: 'SUCCESS' };
      }
      return { status: 'ERROR', code: 'failed_to_start_executor' };
    }

    if (startResult.ecsTaskArn || startResult.taskSize) {
      try {
        await prisma.run.update({
          where: { id: run.id },
          data: { ecsTaskArn: startResult.ecsTaskArn, taskSize: startResult.taskSize },
        });
      } catch (e) {
        this.logger.error(`Failed to record ECS task for run ${run.id}: ${e}`);
      }
    }

    return { status: 'SUCCESS' };
  }
}
