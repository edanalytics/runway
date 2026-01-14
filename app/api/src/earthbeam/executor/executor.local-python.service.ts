import { Job, Run } from '@prisma/client';
import { ExecutorService } from './executor.abstract.service';
import { rm } from 'fs/promises';
import { exec } from 'child_process';
import { Logger } from '@nestjs/common';

export class ExecutorLocalPythonService extends ExecutorService {
  private readonly logger = new Logger(ExecutorLocalPythonService.name);

  async start(run: Run) {
    // Executor errors if these dirs already exist, so we remove them. This might
    // interfere with an already-running Executor process! But that's just a limitation of
    // this local mode: you can only run one Executor process at a time.
    await rm('../executor/local-run/output', { recursive: true, force: true });
    await rm('../executor/local-run/lb-download-dir', { recursive: true, force: true });

    const envVars = await this.envVars(run.id);
    const { stdout, stderr } = exec('venv/bin/python -u ../scripts/main.py', {
      cwd: '../executor/local-run',
      env: {
        ...envVars,
        PATH: `${process.env.PATH}:${process.cwd()}/../executor/local-run/venv/bin`,
        DEPLOYMENT_MODE: 'LOCAL',
        AWS_REGION: this.appConfig.get('AWS_REGION'),
        AWS_PROFILE: this.appConfig.get('LOCAL_AWS_PROFILE'),
      },
    });

    stdout?.on('data', (data) => {
      this.logger.log(`Executor stdout: ${data}`);
    });
    stderr?.on('data', (data) => {
      this.logger.error(`Executor stderr: ${data}`);
    });
  }
}
