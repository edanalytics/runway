import {
  PostStudentMatchSubmitStudentDto,
  schoolYearsOf,
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job, PrismaClient, StudentMatchDecisionKind } from '@prisma/client';
import { JobsService } from './jobs.service';

/** A requested student, as submitting finds them. */
type SubmittingStudent = {
  correlation_id: string;
  /** The current decision's seq and kind, or null for an undecided student. */
  seq: number | null;
  kind: StudentMatchDecisionKind | null;
  /** Whether any of the student's decision rows is in a send run. */
  submitted: boolean;
  /** Whether the job's latest full run reported the student for review. */
  reported: boolean;
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
        code: 'not_found' | 'full_run_not_done' | 'decision_changed' | 'not_ready';
      }
    | { status: 'ERROR'; code: 'invalid_school_years'; indices: number[] }
  > {
    const { jobId, students } = input;
    const correlationIds = students.map(({ correlationId }) => correlationId);

    const outcome = await prisma.$transaction(
      async (tx) => {
        // Everything that creates the job's runs or writes its decisions takes
        // this lock first, so nothing these checks rely on changes before
        // commit. Not FOR
        // UPDATE, which would also block inserts that reference the job, such
        // as ingestion's.
        await tx.$executeRaw`SELECT id FROM public.job WHERE id = ${jobId} FOR NO KEY UPDATE`;

        // Students are reviewed from the latest full run's results, and the
        // send run delivers them from its files.
        const fullRun = await tx.run.findFirst({
          where: { jobId, kind: 'full' },
          orderBy: { id: 'desc' },
          select: { id: true, status: true },
        });

        const rows = await tx.$queryRaw<SubmittingStudent[]>`
          SELECT i.correlation_id, d.seq, d.kind,
                 EXISTS (
                   SELECT 1 FROM public.send_run_decision s
                   WHERE s.job_id = i.job_id AND s.correlation_id = i.correlation_id
                 ) AS submitted,
                 -- Whether the latest full run reported the student for review.
                 EXISTS (
                   SELECT 1 FROM public.student_match_result r
                   WHERE r.job_id = i.job_id AND r.correlation_id = i.correlation_id
                     AND r.run_id = ${fullRun?.id ?? null}::integer
                 ) AS reported,
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
          WHERE i.job_id = ${jobId} AND i.correlation_id = ANY(${correlationIds}::text[])
        `;
        const byId = new Map(rows.map((row) => [row.correlation_id, row]));
        const found = students.map(({ correlationId, version }) => ({
          version,
          student: byId.get(correlationId),
        }));
        if (
          !found.every(
            (entry): entry is { version: number; student: SubmittingStudent } =>
              entry.student !== undefined
          )
        ) {
          return { status: 'ERROR', code: 'not_found' } as const;
        }

        if (fullRun?.status !== 'success') {
          return { status: 'ERROR', code: 'full_run_not_done' } as const;
        }

        if (found.some(({ version, student }) => student.seq !== version)) {
          return { status: 'ERROR', code: 'decision_changed' } as const;
        }
        // Any of the student's rows, not only the current one: every send of a
        // student delivers the same decision row. And only a student the
        // latest full run reported: one it resolved itself it has already
        // sent, and its files don't hold them for a send run.
        if (
          found.some(
            ({ student }) => student.kind !== 'match' || student.submitted || !student.reported
          )
        ) {
          return { status: 'ERROR', code: 'not_ready' } as const;
        }
        const indices = found.flatMap(({ student }, index) =>
          schoolYearsOf(student.roster_details ?? {}) === null ? [index] : []
        );
        if (indices.length > 0) {
          return { status: 'ERROR', code: 'invalid_school_years', indices } as const;
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
