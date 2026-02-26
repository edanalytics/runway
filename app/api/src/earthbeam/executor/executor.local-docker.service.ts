import { ExecutorService } from './executor.service';
import { Run } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { AppConfigService } from 'api/src/config/app-config.service';
import { EarthbeamApiAuthService } from '../api/auth/earthbeam-api-auth.service';

export class ExecutorLocalDockerService implements ExecutorService {
  private readonly logger = new Logger(ExecutorLocalDockerService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly apiAuth: EarthbeamApiAuthService
  ) {}

  async start(run: Run) {
    await this.ensureDockerAvailable();
    await this.ensureExecutorImage();

    const initToken = await this.apiAuth.createInitToken({ runId: run.id });
    const initJobUrl = this.apiAuth.initEndpoint({ runId: run.id });
    const timeoutSeconds = this.appConfig.get('TIMEOUT_SECONDS') ?? '3600';

    // The executor container reaches S3Mock via the host network.
    // TODO: consider putting the executor on the same docker network as S3Mock
    // so it can use the service name directly instead of host.docker.internal.
    const s3Endpoint = process.env.LOCAL_S3_ENDPOINT_URL?.replace(
      /localhost|127\.0\.0\.1/,
      'host.docker.internal'
    );

    const args = [
      'run',
      '--rm',
      '--name',
      `runway-executor-${run.id}`,
      '--add-host=host.docker.internal:host-gateway',
      '-e',
      'DEPLOYMENT_MODE=LOCAL',
      '-e',
      `INIT_TOKEN=${initToken}`,
      '-e',
      `INIT_JOB_URL=${initJobUrl}`,
      '-e',
      `TIMEOUT_SECONDS=${timeoutSeconds}`,
      ...(s3Endpoint ? ['-e', `S3_ENDPOINT_URL=${s3Endpoint}`] : []),
      '-e',
      'AWS_ACCESS_KEY_ID=local',
      '-e',
      'AWS_SECRET_ACCESS_KEY=local',
      'runway_executor',
    ];

    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout?.on('data', (data) => {
      this.logger.log(`Executor stdout: ${data}`);
    });
    proc.stderr?.on('data', (data) => {
      this.logger.error(`Executor stderr: ${data}`);
    });

    proc.on('error', (error) => {
      this.logger.error(`Failed to start local docker executor: ${error}`);
    });
    proc.on('exit', (code) => {
      if (code && code !== 0) {
        this.logger.error(`Local docker executor exited with code ${code}`);
      }
    });
  }

  private async ensureDockerAvailable() {
    await this.execDocker(['version']);
  }

  private async ensureExecutorImage() {
    await this.execDocker(['image', 'inspect', 'runway_executor']);
  }

  private execDocker(args: string[]) {
    return new Promise<void>((resolve, reject) => {
      execFile('docker', args, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}
