import { Inject, Injectable } from '@nestjs/common';
import type { Job, PrismaClient } from '@prisma/client';
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  GetLogEventsCommandOutput,
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
  | { status: 'ERROR'; code: 'NO_TASK' | 'STREAM_NOT_FOUND' };

@Injectable()
export class JobLogsService {
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

  // Executor logs for the job's latest run, oldest first. Pass the returned
  // cursor back to get the next page. atEnd marks the current end of the
  // stream; while the executor is still writing, the cursor picks up lines
  // written since.
  async getLogs(jobId: Job['id'], cursor?: string): Promise<GetJobLogsResult> {
    const lastRun = await this.prisma.run.findFirst({
      where: { jobId },
      orderBy: { createdOn: 'desc' },
      select: { ecsTaskArn: true, taskSize: true },
    });

    // Runs started by the local executors, or before the task was recorded, have no task
    if (!lastRun?.ecsTaskArn || !isExecutorTaskSize(lastRun.taskSize)) {
      return { status: 'ERROR', code: 'NO_TASK' };
    }

    const envLabel = this.appConfig.get('ENVLABEL');
    if (!envLabel) {
      throw new Error('ENVLABEL must be set in order to locate executor logs');
    }

    const logGroupName = executorLogGroupName(envLabel, lastRun.taskSize);
    const logStreamName = executorLogStreamName(envLabel, lastRun.taskSize, lastRun.ecsTaskArn);

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
        // disappears when the log group's retention expires it
        if (e instanceof ResourceNotFoundException) {
          return { status: 'ERROR', code: 'STREAM_NOT_FOUND' };
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
