import { Injectable, Logger } from '@nestjs/common';
import { ExecutorService } from './executor.service';
import { Job, JobFile, Run, SchoolYear } from '@prisma/client';
import { AssumeRoleCommandInput, STSClient } from '@aws-sdk/client-sts';
import { AssumeRoleCommand } from '@aws-sdk/client-sts';
import { ECSClient, RunTaskCommandInput } from '@aws-sdk/client-ecs';
import { RunTaskCommand } from '@aws-sdk/client-ecs';
import { AppConfigService } from '../../config/app-config.service';
import { rosterFileKey } from '../../earthbeam/roster-path';
import { EarthbeamApiAuthService } from '../api/auth/earthbeam-api-auth.service';
import { FileService } from '../../files/file.service';

const DEFAULT_FILE_SIZE_THRESHOLD_BYTES = 100 * 1024 * 1024;

@Injectable()
export class ExecutorAwsService implements ExecutorService {
  private readonly logger = new Logger(ExecutorAwsService.name);

  private readonly stsClient: STSClient;
  private readonly ecsClient: ECSClient;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly apiAuth: EarthbeamApiAuthService,
    private readonly fileService: FileService
  ) {
    const region = this.appConfig.get('AWS_REGION');
    this.stsClient = new STSClient({ region });
    this.ecsClient = new ECSClient({ region });
  }

  async start(run: Run & { job: Job & { schoolYear: SchoolYear; files: JobFile[] } }) {
    const initToken = await this.apiAuth.createInitToken({ runId: run.id });
    const initJobUrl = this.apiAuth.initEndpoint({ runId: run.id });
    const timeoutSeconds = this.appConfig.get('TIMEOUT_SECONDS') ?? '3600';
    const ecsConfig = await this.appConfig.ecsConfig();
    const rosterResource = !run.job.sendToOds
      ? `arn:aws:s3:::${this.appConfig.rosterBucket()}/${rosterFileKey(
          run.job,
          run.job.schoolYear
        )}`
      : null;

    const assumeRoleInput: AssumeRoleCommandInput = {
      RoleArn: ecsConfig.taskRole,
      RoleSessionName: `earthbeam-run-${run.id}`,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:PutObject'],
            Resource: [`arn:aws:s3:::${run.job.fileBucketOrHost}/${run.job.fileBasePath}/*`],
          },
          ...(rosterResource
            ? [
                {
                  Effect: 'Allow',
                  Action: ['s3:GetObject'],
                  Resource: [rosterResource],
                },
              ]
            : []),
        ],
      }),
      DurationSeconds: parseInt(timeoutSeconds),
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

    const taskSize = await this.selectTaskSize(run);
    const taskDefinition = ecsConfig.taskDefinition[taskSize];
    const containerName = ecsConfig.containerName[taskSize];
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
              { name: 'INIT_TOKEN', value: initToken },
              { name: 'INIT_JOB_URL', value: initJobUrl },
              { name: 'TIMEOUT_SECONDS', value: timeoutSeconds },
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

    return;
  }

  // Large input files have caused the executor to run out of memory, so jobs
  // whose input files total at least the configured threshold run on the
  // large task instead of medium.
  private async selectTaskSize(run: Run & { job: Job & { files: JobFile[] } }) {
    const fileSizes = await Promise.all(
      run.job.files.map((file) =>
        this.fileService.getFileSize(file.path, run.job.fileBucketOrHost!)
      )
    );
    const totalInputBytes = fileSizes.reduce((sum, size) => sum + size, 0);
    const thresholdBytes =
      this.appConfig.ecsFileSizeThresholdBytes() ?? DEFAULT_FILE_SIZE_THRESHOLD_BYTES;
    return totalInputBytes >= thresholdBytes ? 'large' : 'medium';
  }
}
