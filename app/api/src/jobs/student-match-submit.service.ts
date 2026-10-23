import { PostStudentMatchSubmitStudentDto } from '@edanalytics/models';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job, PrismaClient } from '@prisma/client';
import { lockJobRow } from './job-row-lock';
import { RunsService } from './runs.service';
import { hasSchoolYears } from './school-years';

@Injectable()
export class StudentMatchSubmitService {
  constructor(private runService: RunsService) {}

  /** Submits saved matches for sending, in a new send run. See AGENTS.md. */
  async submit(
    input: { jobId: Job['id']; students: PostStudentMatchSubmitStudentDto[] },
    prisma: PrismaClient
  ): Promise<
    | { status: 'SUCCESS'; data: { runId: number; launched: boolean } }
    | {
        status: 'ERROR';
        code: 'full_run_not_done' | 'not_found';
      }
    | {
        status: 'ERROR';
        code: 'decision_changed' | 'already_submitted' | 'not_a_match' | 'invalid_school_years';
        indices: number[];
      }
  > {
    const { jobId, students } = input;
    const correlationIds = students.map(({ correlationId }) => correlationId);

    const outcome = await prisma.$transaction(
      async (tx) => {
        await lockJobRow(tx, jobId, 'FOR NO KEY UPDATE');

        // Students are reviewed from the full run's results, and the send run
        // delivers them from its files. A fuzzy job has one, since it's started
        // once. Take the latest, as the job's other reads of its full run do.
        const fullRun = await tx.run.findFirst({
          where: { jobId, kind: 'full' },
          orderBy: { createdOn: 'desc' },
          select: { status: true },
        });
        if (fullRun?.status !== 'success') {
          return { status: 'ERROR', code: 'full_run_not_done' } as const;
        }

        const found = await tx.studentInputDetails.findMany({
          where: { jobId, correlationId: { in: correlationIds } },
          select: {
            correlationId: true,
            studentMatchDecision: {
              orderBy: { seq: 'desc' },
              take: 1,
              select: {
                seq: true,
                kind: true,
                rosterDetails: true,
                studentMatchSuggestion: { select: { rosterDetails: true } },
              },
            },
          },
        });
        // A requested student with no row is one the job doesn't have.
        const decisionsById = new Map(
          found.map(({ correlationId, studentMatchDecision }) => [
            correlationId,
            studentMatchDecision,
          ])
        );
        if (!correlationIds.every((correlationId) => decisionsById.has(correlationId))) {
          return { status: 'ERROR', code: 'not_found' } as const;
        }
        const requested = students.map(({ correlationId, version }) => ({
          correlationId,
          version,
          // The current decision, or undefined for an undecided student.
          decision: decisionsById.get(correlationId)?.[0],
        }));
        // The indices are positions in the request's students, so they come
        // from requested rather than the queries' rows.
        const decisionChanged = requested.flatMap(({ version, decision }, index) =>
          decision?.seq !== version ? [index] : []
        );
        if (decisionChanged.length > 0) {
          return { status: 'ERROR', code: 'decision_changed', indices: decisionChanged } as const;
        }
        const notAMatch = requested.flatMap(({ decision }, index) =>
          decision?.kind !== 'match' ? [index] : []
        );
        if (notAMatch.length > 0) {
          return { status: 'ERROR', code: 'not_a_match', indices: notAMatch } as const;
        }
        const invalidSchoolYears = requested.flatMap(({ decision }, index) => {
          // A match has exactly one basis (037's check): a suggestion, or a
          // search, whose roster details the decision holds itself.
          const basis = decision?.studentMatchSuggestion ?? decision;
          return !hasSchoolYears(basis?.rosterDetails) ? [index] : [];
        });
        if (invalidSchoolYears.length > 0) {
          return {
            status: 'ERROR',
            code: 'invalid_school_years',
            indices: invalidSchoolYears,
          } as const;
        }

        // A student whose send runs have all ended in `error` may be sent
        // again. The version check above has matched the row a resend delivers
        // to the current decision, and it is the row every earlier send
        // delivered: decisions refuse a student once any of their rows is in a
        // send run, so every send of a student delivers the same decision row.
        //
        // Resending relies on `error` being final, which init, launch and
        // `completeRun` enforce.
        const submitted = await tx.sendRunDecision.findMany({
          where: {
            jobId,
            correlationId: { in: correlationIds },
            run: { status: { not: 'error' } },
          },
          select: { correlationId: true },
        });
        const submittedIds = new Set(submitted.map(({ correlationId }) => correlationId));
        const alreadySubmitted = requested.flatMap(({ correlationId }, index) =>
          submittedIds.has(correlationId) ? [index] : []
        );
        if (alreadySubmitted.length > 0) {
          return { status: 'ERROR', code: 'already_submitted', indices: alreadySubmitted } as const;
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
    // launch marks the run `error` and is reported in `launched`, but the
    // submit stands: undoing it would let those students take new decisions,
    // and no decision may follow a send, even a failed one.
    // Submitting the same decisions again is what unblocks them.
    const launch = await this.runService.launch(outcome.run, prisma);
    return {
      status: 'SUCCESS',
      data: { runId: outcome.run.id, launched: launch.status === 'SUCCESS' },
    };
  }
}
