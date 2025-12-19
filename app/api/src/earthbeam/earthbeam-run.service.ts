import { Injectable, Logger } from '@nestjs/common';
import { ECSClient, RunTaskCommand, RunTaskCommandInput } from '@aws-sdk/client-ecs';
import { STSClient, AssumeRoleCommand, AssumeRoleCommandInput } from '@aws-sdk/client-sts';
import { EarthbeamApiAuthService } from './api/auth/earthbeam-api-auth.service';
import { Job, PrismaClient, Run } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class EarthbeamRunService {
  private readonly logger = new Logger(EarthbeamRunService.name);
  private readonly ecsClient = new ECSClient({ region: process.env.AWS_REGION });
  private readonly stsClient = new STSClient({ region: process.env.AWS_REGION });

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly apiAuth: EarthbeamApiAuthService
  ) {}

  async start(job: Job, prisma: PrismaClient) {
    const runs = await prisma.run.findMany({ where: { jobId: job.id } });
    if (runs.some((run) => run.status === 'running' || run.status === 'new')) {
      return { result: 'JOB_IN_PROGRESS', job };
    }

    const run = await prisma.run.create({
      data: {
        jobId: job.id,
        status: 'new', // it may take aws a few min to start the run, so we won't update this status as part of this function
      },
    });

    try {
      await this.startExecutor(job, run);
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

      return { result: 'JOB_START_FAILED', job, error: e };
    }

    return { result: 'JOB_STARTED', job, run };
  }

  async initRun(
    runId: number,
    prisma: PrismaClient
  ): Promise<
    { status: 'SUCCESS'; run: Run } | { status: 'ERROR'; reason: 'not found' | 'invalid token' }
  > {
    return await prisma.$transaction(async (tx) => {
      let run = await tx.run.findUnique({ where: { id: runId } });
      if (!run) {
        return { status: 'ERROR', reason: 'not found' };
      }

      if (run.status !== 'new') {
        // cannot use a token twice, so if run is not new, the token has already been used
        return { status: 'ERROR', reason: 'invalid token' };
      }

      run = await tx.run.update({
        where: { id: runId },
        data: { status: 'running' },
      });

      return { status: 'SUCCESS', run };
    });
  }

  async updateStatus(runId: Run['id'], status: Run['status'], prisma: PrismaClient) {
    this.logger.log(`updating status for run ${runId} to ${status}`);
  }

  private async startExecutor(job: Job, run: Run) {
    // TODO: move all this ECS stuff to some separate service that can be injected
    // so we can handle running locally vs. on AWS, etc.
    const token = await this.apiAuth.createInitToken({ runId: run.id });
    const apiEndpoint = this.apiAuth.initEndpoint({ runId: run.id });
    const ecsConfig = await this.appConfig.ecsConfig();

    const assumeRoleInput: AssumeRoleCommandInput = {
      RoleArn: ecsConfig.taskRole,
      RoleSessionName: `earthbeam-run-${run.id}`,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:PutObject'],
            Resource: [`arn:aws:s3:::${job.fileBucketOrHost}/${job.fileBasePath}/*`],
          },
        ],
      }),
      DurationSeconds: ecsConfig.timeout,
    };

    const stsResponse = await this.stsClient.send(new AssumeRoleCommand(assumeRoleInput));
    if (!stsResponse.Credentials) {
      this.logger.error(
        `Failed to assume role for ECS task. Run: ${run.id}. STS Response: ${JSON.stringify(
          stsResponse,
          null,
          2
        )}`
      );
      throw new Error('Failed to assume role for ECS task');
    }

    const taskDefinition = ecsConfig.taskDefinition.small; // let's start with small. if needed, we can use medium and large
    const containerName = ecsConfig.containerName.small;
    const taskInput: RunTaskCommandInput = {
      launchType: 'FARGATE',
      taskDefinition: taskDefinition,
      cluster: ecsConfig.cluster,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ecsConfig.subnets,
          securityGroups: ecsConfig.securityGroups,
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: containerName,
            environment: [
              {
                name: 'INIT_TOKEN',
                value: token,
              },
              {
                name: 'INIT_JOB_URL',
                value: apiEndpoint,
              },
              {
                name: 'AWS_ACCESS_KEY_ID',
                value: stsResponse.Credentials.AccessKeyId,
              },
              {
                name: 'AWS_SECRET_ACCESS_KEY',
                value: stsResponse.Credentials.SecretAccessKey,
              },
              {
                name: 'AWS_SESSION_TOKEN',
                value: stsResponse.Credentials.SessionToken,
              },
              {
                name: 'TIMEOUT_SECONDS',
                value: ecsConfig.timeout.toString(),
              },
            ],
          },
        ],
      },
    };

    const command = new RunTaskCommand(taskInput);
    const response = await this.ecsClient.send(command);

    if (response.failures?.length) {
      const reasons = response.failures.map((f) => f.reason).join(', ');
      throw new Error(`Failed to start ECS task for run ${run.id}. Reasons: ${reasons}`);
    }

    return response; // TODO: package this more neatly
  }
}
