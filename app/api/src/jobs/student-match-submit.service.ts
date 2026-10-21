import {
  PostStudentMatchSubmitStudentDto,
  schoolYearsOf,
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job, PrismaClient, StudentMatchDecisionKind } from '@prisma/client';
import { lockJobRow } from './job-row-lock';
import { JobsService } from './jobs.service';

/** A requested student, as submitting finds them. */
type SubmittingStudent = {
  correlation_id: string;
  /** The current decision's seq and kind, or null for an undecided student. */
  seq: number | null;
  kind: StudentMatchDecisionKind | null;
  /** Whether any of the student's decision rows is in a send run. */
  submitted: boolean;
  /** The current decision's basis's roster details, for a match. */
  roster_details: StudentRosterDetailsJson | null;
};

@Injectable()
export class StudentMatchSubmitService {
  constructor(private jobsService: JobsService) {}

  /** Submits saved matches for sending, in a new send run. See AGENTS.md. */
  async submit(
    input: { jobId: Job['id']; students: PostStudentMatchSubmitStudentDto[] },
    prisma: PrismaClient
  ): Promise<
    | { status: 'SUCCESS'; data: { runId: number } }
    | {
        status: 'ERROR';
        code: 'not_found' | 'full_run_not_done' | 'decision_changed';
      }
    | { status: 'ERROR'; code: 'not_ready' | 'invalid_school_years'; indices: number[] }
  > {
    const { jobId, students } = input;
    const correlationIds = students.map(({ correlationId }) => correlationId);

    const outcome = await prisma.$transaction(
      async (tx) => {
        await lockJobRow(tx, jobId, 'FOR NO KEY UPDATE');

        const rows = await tx.$queryRaw<SubmittingStudent[]>`
          SELECT i.correlation_id, d.seq, d.kind,
                 EXISTS (
                   SELECT 1 FROM public.send_run_decision s
                   WHERE s.job_id = i.job_id AND s.correlation_id = i.correlation_id
                 ) AS submitted,
                 -- A match has exactly one basis (037's check), so one of these.
                 COALESCE(sg.roster_details, d.roster_details) AS roster_details
          FROM public.student_input_details i
          LEFT JOIN LATERAL (
            SELECT d.seq, d.kind, d.result_id, d.ordinal, d.roster_details
            FROM public.student_match_decision d
            WHERE d.job_id = i.job_id AND d.correlation_id = i.correlation_id
            ORDER BY d.seq DESC
            LIMIT 1
          ) d ON true
          LEFT JOIN public.student_match_suggestion sg
            ON sg.result_id = d.result_id AND sg.ordinal = d.ordinal
          WHERE i.job_id = ${jobId}::int AND i.correlation_id = ANY(${correlationIds}::text[])
        `;
        const byId = new Map(rows.map((row) => [row.correlation_id, row]));
        const requested = students.map(({ correlationId, version }) => ({
          version,
          student: byId.get(correlationId),
        }));
        if (
          !requested.every(
            (entry): entry is { version: number; student: SubmittingStudent } =>
              entry.student !== undefined
          )
        ) {
          return { status: 'ERROR', code: 'not_found' } as const;
        }

        // Students are reviewed from the full run's results, and the send run
        // delivers them from its files. A job has one, since it's started once.
        const fullRun = await tx.run.findFirst({
          where: { jobId, kind: 'full' },
          select: { status: true },
        });
        if (fullRun?.status !== 'success') {
          return { status: 'ERROR', code: 'full_run_not_done' } as const;
        }

        if (requested.some(({ version, student }) => student.seq !== version)) {
          return { status: 'ERROR', code: 'decision_changed' } as const;
        }
        // Any of the student's rows, not only the current one: every send of a
        // student delivers the same decision row.
        const notReady = requested.flatMap(({ student }, index) =>
          student.kind !== 'match' || student.submitted ? [index] : []
        );
        if (notReady.length > 0) {
          return { status: 'ERROR', code: 'not_ready', indices: notReady } as const;
        }
        const invalidSchoolYears = requested.flatMap(({ student }, index) =>
          schoolYearsOf(student.roster_details) === null ? [index] : []
        );
        if (invalidSchoolYears.length > 0) {
          return {
            status: 'ERROR',
            code: 'invalid_school_years',
            indices: invalidSchoolYears,
          } as const;
        }

        const run = await tx.run.create({
          data: { jobId, kind: 'send', status: 'new' },
          include: { job: { include: { schoolYear: true, files: true } } },
        });
        await tx.sendRunDecision.createMany({
          data: students.map(({ correlationId, version }) => ({
            runId: run.id,
            jobId,
            correlationId,
            seq: version,
          })),
        });
        return { status: 'SUCCESS', run } as const;
      },
      // Each statement sees what committed before it, including the send run
      // of a submit this one waited for at the lock.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );
    if (outcome.status === 'ERROR') {
      return outcome;
    }

    // After commit, so the Executor finds the run and its decisions. A failed
    // launch is recorded on the run, and the submit stands.
    await this.jobsService.launchRun(outcome.run, prisma);
    return { status: 'SUCCESS', data: { runId: outcome.run.id } };
  }
}
