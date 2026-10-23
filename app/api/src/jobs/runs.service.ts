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
   * run done, in error.
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

      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'error',
          runError: {
            create: {
              code: 'failed_to_start_executor',
              payload: { stacktrace: 'stacktrace unavailable' },
            },
          },
          runUpdate: {
            create: {
              action: 'done',
              status: 'failure',
            },
          },
        },
      });

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
