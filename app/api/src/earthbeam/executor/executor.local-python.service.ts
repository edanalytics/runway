import { Run } from '@prisma/client';
import { ExecutorService } from './executor.service';
import { rm, access } from 'fs/promises';
import { exec } from 'child_process';
import { Logger } from '@nestjs/common';
import * as path from 'path';
import { AppConfigService } from 'api/src/config/app-config.service';
import { EarthbeamApiAuthService } from '../api/auth/earthbeam-api-auth.service';

export class ExecutorLocalPythonService implements ExecutorService {
  private readonly logger = new Logger(ExecutorLocalPythonService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly apiAuth: EarthbeamApiAuthService
  ) {}

  async start(run: Run) {
    const cwd = path.resolve(process.cwd(), '../executor/local-run');
    const pythonPath = path.join(cwd, 'venv/bin/python');
    const scriptPath = path.resolve(cwd, '../scripts/main.py');

    try {
      await access(pythonPath);
      await access(scriptPath);
    } catch (error) {
      this.logger.error(
        `Local executor missing runtime. Expected ${pythonPath} and ${scriptPath}.`
      );
      throw error;
    }

    // Executor errors if these dirs already exist, so we remove them. This might
    // interfere with an already-running Executor process! But that's just a limitation of
    // this local mode: you can only run one Executor process at a time.
    await rm('../executor/local-run/output', { recursive: true, force: true });
    await rm('../executor/local-run/lb-download-dir', { recursive: true, force: true });

    const initToken = await this.apiAuth.createInitToken({ runId: run.id });
    const initJobUrl = this.apiAuth.initEndpoint({ runId: run.id });
    const timeoutSeconds = this.appConfig.get('TIMEOUT_SECONDS') ?? '3600';

    const proc = exec(`${pythonPath} -u ${scriptPath}`, {
      cwd,
      env: {
        INIT_TOKEN: initToken,
        INIT_JOB_URL: initJobUrl,
        TIMEOUT_SECONDS: timeoutSeconds,
        PATH: `${process.env.PATH}:${path.join(cwd, 'venv/bin')}`,
        PYTHONPATH: `${path.resolve(cwd, '..')}:${process.env.PYTHONPATH ?? ''}`,
        DEPLOYMENT_MODE: 'LOCAL',
        S3_ENDPOINT_URL: this.appConfig.get('LOCAL_S3_ENDPOINT_URL') ?? '',
        AWS_ACCESS_KEY_ID: 'local',
        AWS_SECRET_ACCESS_KEY: 'local',
      },
    });

    proc.stdout?.on('data', (data) => {
      this.logger.log(`Executor stdout: ${data}`);
    });
    proc.stderr?.on('data', (data) => {
      this.logger.error(`Executor stderr: ${data}`);
    });
    proc.on('error', (error) => {
      this.logger.error(`Executor failed to start: ${error}`);
    });
  }
}
