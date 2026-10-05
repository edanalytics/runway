import { Inject, Injectable } from '@nestjs/common';
import type { Job, PrismaClient } from '@prisma/client';
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-cloudwatch-logs';
import { PRISMA_READ_ONLY } from '../database';
import { AppConfigService } from '../config/app-config.service';
import {
  executorLogGroupName,
  executorLogStreamName,
  isExecutorTaskSize,
} from '../earthbeam/executor/executor-task-names';

const PAGE_SIZE = 1000;
// GetLogEvents can return empty pages before the end of a stream, so a page
// with no events doesn't mean there are none left. Follow a few of them
// before handing the cursor back, rather than following them indefinitely.
const MAX_REQUESTS_PER_PAGE = 5;

export type JobLogEvent = { timestamp: number | null; message: string };

export type GetJobLogsResult =
  | { status: 'SUCCESS'; data: { events: JobLogEvent[]; nextCursor: string | null } }
  | { status: 'ERROR'; code: 'NO_TASK' | 'STREAM_NOT_FOUND' };

@Injectable()
export class JobLogsService {
  private readonly logsClient: CloudWatchLogsClient;

  constructor(
    @Inject(PRISMA_READ_ONLY) private readonly prisma: PrismaClient,
    private readonly appConfig: AppConfigService
  ) {
    this.logsClient = new CloudWatchLogsClient({ region: this.appConfig.get('AWS_REGION') });
  }

  // Executor logs for the job's latest run, oldest first. Pass the returned
  // cursor back to get the next page; it is null once the stream is exhausted.
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

    let token = cursor;
    for (let i = 0; i < MAX_REQUESTS_PER_PAGE; i++) {
      let response;
      try {
        response = await this.logsClient.send(
          new GetLogEventsCommand({
            logGroupName,
            logStreamName,
            startFromHead: true,
            limit: PAGE_SIZE,
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

      // At the end of a stream, CloudWatch returns the token it was given
      const nextToken = response.nextForwardToken;
      const atEnd = !nextToken || nextToken === token;
      const events = (response.events ?? []).map((e) => ({
        timestamp: e.timestamp ?? null,
        message: e.message ?? '',
      }));

      if (events.length || atEnd) {
        return { status: 'SUCCESS', data: { events, nextCursor: atEnd ? null : nextToken } };
      }
      token = nextToken;
    }

    return { status: 'SUCCESS', data: { events: [], nextCursor: token ?? null } };
  }
}
