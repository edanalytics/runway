import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, JobFile, PrismaClient, Run, SchoolYear } from '@prisma/client';
import { EarthbeamApiSendRunDto } from '@edanalytics/models';
import { AppConfigService } from '../../config/app-config.service';
import { EXECUTOR_SERVICE, ExecutorService } from './executor.service';

/*
 * SPIKE: the seam between a submitted batch and the Executor's send run
 * (EDFIAL-480). Theo's side isn't pushed, so everything below is an assumed
 * contract, to compare with his at the integration. Every assumption is here.
 *
 * A1. Launch. A send run is an ordinary `run` row of the job, launched exactly
 *     as a first run is: `ExecutorService.start(run)`, so ECS RunTask (or the
 *     local executors) with INIT_TOKEN and INIT_JOB_URL. No new env vars, task
 *     definition or container.
 * A2. Run kind. The Executor learns it's a send run from the job payload
 *     (`GET /earthbeam/jobs/:runId`), not from the launch: `runType: 'send'`.
 *     A first run's payload has no `runType`. The app knows a run is a send
 *     run because a batch names it (`student_match_batch.run_id`); the run
 *     table has no kind column.
 * A3. Students. The payload lists exactly the batch's members, inline, as
 *     `send.students: [{ correlationId, studentUniqueId }]`. Not an app URL.
 *     The student unique id is the decision's answer
 *     (`student_match_decision.student_unique_id`), whatever its basis.
 * A4. Source. `send.sourceRunId` is the job's first run. The send run reads
 *     that run's transformed Ed-Fi JSONL, with correlation ids embedded
 *     (Decisions Log #24), from where the first run saved it under
 *     `appDataBasePath`. The app doesn't pass a file path: it doesn't know one.
 * A5. Steps. A send run skips the roster fetch, earthmover and IDRS. It swaps
 *     each listed correlation id for its student unique id, keeps only those
 *     lines, sends them, and saves its output as separate, final JSONL files.
 *     So its payload carries no `identityService`, `studentMatchResults` or
 *     `roster` URL, and it posts no match results.
 * A6. Callbacks. It reports to its own run's callbacks, as any run does:
 *     `appUrls.status`, `error`, `summary` and `outputFiles`, keyed by its run
 *     id, ending with `POST /status { action: done }`. The app ties the run
 *     back to the batch by run id. No batch-specific callback.
 * A7. Everything else in the payload is the job's, as for its first run:
 *     bundle, input params, ODS credentials, `sendToOds`,
 *     `crossYearMatchAvailable`, `idMatchingMode` (always `fuzzy`).
 * A8. Concurrency. Send runs may overlap each other and need nothing from one
 *     another: the app guarantees their students are disjoint. A batch is
 *     submitted only after the first run succeeded.
 */

/** Whether the seam really launches the Executor. Off by default: it logs. */
const launches = (mode: string | undefined) => mode === 'executor';

@Injectable()
export class SendRunService {
  private readonly logger = new Logger(SendRunService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    @Inject(EXECUTOR_SERVICE) private readonly executor: ExecutorService
  ) {}

  /**
   * Starts the send run that delivers a batch. The run and the batch are
   * already committed, so the Executor's init call finds them. Throws if the
   * Executor couldn't be started; the caller records that on the run.
   *
   * With `SEND_RUN_START` unset, it only logs: there's no Executor to start
   * locally unless one is configured.
   */
  async startSendRun(
    run: Run & { job: Job & { schoolYear: SchoolYear; files: JobFile[] } },
    batch: { id: number; memberCount: number }
  ) {
    if (!launches(this.appConfig.get('SEND_RUN_START'))) {
      this.logger.log(
        `send run not launched (SEND_RUN_START unset): jobId=${run.jobId} runId=${run.id} batchId=${batch.id} students=${batch.memberCount}`
      );
      return { ecsTaskArn: null, taskSize: null };
    }
    this.logger.log(
      `starting send run: jobId=${run.jobId} runId=${run.id} batchId=${batch.id} students=${batch.memberCount}`
    );
    return this.executor.start(run);
  }

  /**
   * The send-run part of a run's payload (A2–A4), or null for a run no batch
   * names, such as a job's first run.
   */
  async sendRunPayload(
    runId: Run['id'],
    prisma: PrismaClient
  ): Promise<EarthbeamApiSendRunDto | null> {
    const batch = await prisma.studentMatchBatch.findFirst({
      where: { runId },
      include: {
        studentMatchBatchMember: {
          orderBy: { correlationId: 'asc' },
          include: { studentMatchDecision: { select: { studentUniqueId: true } } },
        },
      },
    });
    if (!batch) {
      return null;
    }
    const firstRun = await prisma.run.findFirstOrThrow({
      where: { jobId: batch.jobId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return {
      batchId: batch.id,
      sourceRunId: firstRun.id,
      students: batch.studentMatchBatchMember.map((member) => ({
        correlationId: member.correlationId,
        // Members are only ever matches, which always have an answer.
        studentUniqueId: member.studentMatchDecision.studentUniqueId!,
      })),
    };
  }
}
