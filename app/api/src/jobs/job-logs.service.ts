import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, PrismaClient, Run } from '@prisma/client';
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  GetLogEventsCommandOutput,
  InvalidParameterException,
  ResourceNotFoundException,
} from '@aws-sdk/client-cloudwatch-logs';
import { GetJobLogEventDto, GetJobLogsDto } from '@edanalytics/models';
import { PRISMA_READ_ONLY } from '../database';
import { AppConfigService } from '../config/app-config.service';
import {
  executorLogGroupName,
  executorLogStreamName,
  isExecutorTaskSize,
} from '../earthbeam/executor/executor-task-names';
import { MockExecutorLogsClient } from './job-logs.mock-client';

const PAGE_SIZE = 10000;
// GetLogEvents can return short or empty pages before the end of a stream, so
// keep requesting until the page is full or CloudWatch reports the end, which
// costs one extra request at the end. Cap the requests rather than following
// short pages indefinitely.
const MAX_REQUESTS_PER_PAGE = 5;

export type GetJobLogsResult =
  | { status: 'SUCCESS'; data: GetJobLogsDto }
  | { status: 'ERROR'; code: 'NO_RUN' | 'NO_TASK' | 'STREAM_NOT_FOUND' | 'INVALID_CURSOR' };

@Injectable()
export class JobLogsService {
  private readonly logger = new Logger(JobLogsService.name);
  private readonly logsClient: {
    send(command: GetLogEventsCommand): Promise<GetLogEventsCommandOutput>;
  };

  constructor(
    @Inject(PRISMA_READ_ONLY) private readonly prisma: PrismaClient,
    private readonly appConfig: AppConfigService
  ) {
    this.logsClient =
      this.appConfig.get('LOCAL_EXECUTOR_LOGS') === 'mock' && this.appConfig.isDevEnvironment()
        ? new MockExecutorLogsClient()
        : new CloudWatchLogsClient({ region: this.appConfig.get('AWS_REGION') });
  }

  // Executor logs for one of the job's runs, oldest first. Pass the returned
  // cursor back to get the next page. atEnd marks the current end of the
  // stream; while the executor is still writing, the cursor picks up lines
  // written since.
  async getLogs(jobId: Job['id'], runId: Run['id'], cursor?: string): Promise<GetJobLogsResult> {
    // The caller is authorized for the job, so the run must be one of its own
    const run = await this.prisma.run.findFirst({
      where: { id: runId, jobId },
      select: { ecsTaskArn: true, taskSize: true },
    });
    if (!run) {
      return { status: 'ERROR', code: 'NO_RUN' };
    }

    // Runs started by the local executors, or before the task was recorded, have no task
    if (!run.ecsTaskArn || !isExecutorTaskSize(run.taskSize)) {
      return { status: 'ERROR', code: 'NO_TASK' };
    }

    const envLabel = this.appConfig.get('ENVLABEL');
    if (!envLabel) {
      throw new Error('ENVLABEL must be set in order to locate executor logs');
    }

    const logGroupName = executorLogGroupName(envLabel, run.taskSize);
    const logStreamName = executorLogStreamName(envLabel, run.taskSize, run.ecsTaskArn);

    const events: GetJobLogEventDto[] = [];
    let token = cursor;
    for (let i = 0; i < MAX_REQUESTS_PER_PAGE && events.length < PAGE_SIZE; i++) {
      let response;
      try {
        response = await this.logsClient.send(
          new GetLogEventsCommand({
            logGroupName,
            logStreamName,
            startFromHead: true,
            limit: PAGE_SIZE - events.length,
            nextToken: token,
          })
        );
      } catch (e) {
        // The stream doesn't exist until the container writes to it, and
        // disappears when the log group's retention expires it. A missing log
        // group lands here too, so name both in case the names have drifted
        // from the ECS task definitions.
        if (e instanceof ResourceNotFoundException) {
          this.logger.warn(`Executor log stream not found: ${logGroupName} ${logStreamName}`);
          return { status: 'ERROR', code: 'STREAM_NOT_FOUND' };
        }
        // A cursor CloudWatch won't accept, such as one from another run's
        // stream, is the caller's mistake rather than a failure
        if (e instanceof InvalidParameterException && cursor !== undefined) {
          return { status: 'ERROR', code: 'INVALID_CURSOR' };
        }
        throw e;
      }

      events.push(
        ...(response.events ?? []).map((e) => ({
          timestamp: e.timestamp ?? null,
          message: e.message ?? '',
        }))
      );

      // At the end of a stream, CloudWatch returns the token it was given
      const nextToken = response.nextForwardToken;
      if (!nextToken || nextToken === token) {
        return { status: 'SUCCESS', data: { events, nextCursor: token ?? null, atEnd: true } };
      }
      token = nextToken;
    }

    return { status: 'SUCCESS', data: { events, nextCursor: token ?? null, atEnd: false } };
  }
}
