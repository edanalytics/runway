import { Job, Run } from '@prisma/client';
import { ExecutorService } from './executor.abstract.service';
import { rm, access } from 'fs/promises';
import { exec } from 'child_process';
import { Logger } from '@nestjs/common';
import * as path from 'path';

export class ExecutorLocalPythonService extends ExecutorService {
  private readonly logger = new Logger(ExecutorLocalPythonService.name);

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

    const envVars = await this.envVars(run.id);
    const proc = exec(`${pythonPath} -u ${scriptPath}`, {
      cwd,
      env: {
        ...envVars,
        PATH: `${process.env.PATH}:${path.join(cwd, 'venv/bin')}`,
        PYTHONPATH: `${path.resolve(cwd, '..')}:${process.env.PYTHONPATH ?? ''}`,
        DEPLOYMENT_MODE: 'LOCAL',
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
