import { Injectable, Logger } from '@nestjs/common';
import { ExecutorService } from './executor.abstract.service';
import { Job, Run } from '@prisma/client';
import { AssumeRoleCommandInput, STSClient } from '@aws-sdk/client-sts';
import { AssumeRoleCommand } from '@aws-sdk/client-sts';
import { ECSClient, RunTaskCommandInput } from '@aws-sdk/client-ecs';
import { RunTaskCommand } from '@aws-sdk/client-ecs';

@Injectable()
export class ExecutorAwsService extends ExecutorService {
  private readonly logger = new Logger(ExecutorAwsService.name);

  private readonly stsClient = new STSClient({ region: process.env.AWS_REGION });
  private readonly ecsClient = new ECSClient({ region: process.env.AWS_REGION });

  async start(run: Run & { job: Job }) {
    const envVars = await this.envVars(run.id);
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
            Resource: [`arn:aws:s3:::${run.job.fileBucketOrHost}/${run.job.fileBasePath}/*`],
          },
        ],
      }),
      DurationSeconds: parseInt(envVars.TIMEOUT_SECONDS),
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
              ...Object.entries(await this.envVars(run.id)).map(([name, value]) => ({
                name,
                value,
              })),
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
}
