import { ExecutorService } from './executor.abstract.service';
import { Run } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { spawn } from 'child_process';

export class ExecutorLocalDockerService extends ExecutorService {
  private readonly logger = new Logger(ExecutorLocalDockerService.name);

  async start(run: Run) {
    const envVars = await this.envVars(run.id);
    const storageRoot = this.appConfig.localStorageRoot();
    if (!storageRoot) {
      throw new Error('Local storage root is not configured');
    }

    const args = [
      'run',
      '--rm',
      '--name',
      `runway-executor-${run.id}`,
      '--add-host=host.docker.internal:host-gateway',
      '-v',
      `${storageRoot}:/storage`,
      '-e',
      'DEPLOYMENT_MODE=LOCAL',
      '-e',
      `INIT_TOKEN=${envVars.INIT_TOKEN}`,
      '-e',
      `INIT_JOB_URL=${envVars.INIT_JOB_URL}`,
      '-e',
      `TIMEOUT_SECONDS=${envVars.TIMEOUT_SECONDS}`,
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
  }
}
