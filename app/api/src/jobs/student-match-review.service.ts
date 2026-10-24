import {
  GetStudentMatchCountsDto,
  GetIdrsStudentDto,
  MATCH_REVIEW_STUDENT_LIMIT,
  pickStudentSearchDetails,
  PostStudentMatchDecisionDto,
  restsOnSearch,
  restsOnSuggestion,
  StudentMatchDecisionWithUser,
  StudentSearchDetailsDto,
  studentMatchStatus,
} from '@edanalytics/models';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job, PrismaClient, StudentMatchDecision, User } from '@prisma/client';
import { PRISMA_READ_ONLY } from '../database';
import { IdrsSearchService } from '../idrs/idrs-search.service';
import { lockJobRow } from './job-row-lock';
import { isLoadableStudent } from './school-years';

/**
 * A decision row as the API shows it: none for a clear, and a search basis's
 * columns gathered into `search`. They reach the client only through here.
 */
const toStudentMatchDecision = ({
  user,
  searchDetails,
  rosterDetails,
  ...row
}: StudentMatchDecision & { user: User | null }): StudentMatchDecisionWithUser | null => {
  if (row.kind === 'clear') {
    return null;
  }
  return {
    ...row,
    version: row.seq,
    decidedBy: user,
    // The table's check requires both, or neither.
    search:
      searchDetails !== null && rosterDetails !== null ? { searchDetails, rosterDetails } : null,
  };
};

/** An exclude or a clear: nothing beside its kind. */
type NoAnswerColumns = {
  studentUniqueId: null;
  resultId: null;
  ordinal: null;
  searchDetails: null;
  rosterDetails: null;
};

/** A match to a suggestion: its answer, and the suggestion it picked. */
type SuggestionMatchColumns = {
  studentUniqueId: string;
  resultId: bigint;
  ordinal: number;
  searchDetails: null;
  rosterDetails: null;
};

/** A match to a search: its answer, and the search. */
type SearchMatchColumns = {
  studentUniqueId: string;
  resultId: null;
  ordinal: null;
  // JSON text, for the insert's ::jsonb casts. Prisma would bind an object as
  // JSON itself, but an array as a PostgreSQL array, so text doesn't depend on
  // how it binds a value.
  searchDetails: string;
  rosterDetails: string;
};

/**
 * What a decision row stores beside its kind: a match's answer, the student
 * unique id, and exactly one basis. The table's check enforces the same sets.
 */
type DecisionColumns = NoAnswerColumns | SuggestionMatchColumns | SearchMatchColumns;

const noAnswerOrBasis: NoAnswerColumns = {
  studentUniqueId: null,
  resultId: null,
  ordinal: null,
  searchDetails: null,
  rosterDetails: null,
};

export const noStudentsToMatch: GetStudentMatchCountsDto = {
  total: 0,
  toReview: 0,
  ready: 0,
  excluded: 0,
  reprocessing: 0,
  reprocessed: 0,
  runFailed: 0,
};

@Injectable()
export class StudentMatchReviewService {
  constructor(
    @Inject(PRISMA_READ_ONLY) private prisma: PrismaClient,
    private idrsSearch: IdrsSearchService
  ) {}

  /** Overridable so tests can reach the limit without seeding 1,000 students. */
  studentMatchReviewLimit = MATCH_REVIEW_STUDENT_LIMIT;

  /**
   * Each job's student match counts. Job reads and the review read both use
   * this, so they count the same way. Jobs with no students are absent.
   *
   * Takes a Prisma client, though it only reads, so the review read can run it
   * in its transaction. Other callers use the service's read-only client.
   */
  async getStudentMatchCounts(
    jobIds: Job['id'][],
    prisma: PrismaClient = this.prisma
  ): Promise<Map<Job['id'], GetStudentMatchCountsDto>> {
    // Keep the statuses in step with studentMatchStatus.
    const rows = await prisma.$queryRaw<
      {
        job_id: number;
        total: bigint;
        to_review: bigint;
        ready: bigint;
        excluded: bigint;
        reprocessing: bigint;
        reprocessed: bigint;
        run_failed: bigint;
      }[]
    >`
      SELECT i.job_id,
             count(*) AS total,
             count(*) FILTER (WHERE d.kind IS NULL OR d.kind = 'clear') AS to_review,
             count(*) FILTER (WHERE d.kind = 'match' AND d.send_run_status IS NULL) AS ready,
             count(*) FILTER (WHERE d.kind = 'exclude') AS excluded,
             count(*) FILTER (
               WHERE d.kind = 'match' AND d.send_run_status IN ('new', 'running')
             ) AS reprocessing,
             count(*) FILTER (WHERE d.kind = 'match' AND d.send_run_status = 'success') AS reprocessed,
             count(*) FILTER (WHERE d.kind = 'match' AND d.send_run_status = 'error') AS run_failed
      FROM public.student_input_details i
      LEFT JOIN LATERAL (
        SELECT kind, (
                 SELECT r.status
                 FROM public.send_run_decision s
                 JOIN public.run r ON r.id = s.run_id
                 WHERE s.job_id = d.job_id AND s.correlation_id = d.correlation_id
                   AND s.seq = d.seq
                 ORDER BY s.run_id DESC
                 LIMIT 1
               ) AS send_run_status
        FROM public.student_match_decision d
        WHERE d.job_id = i.job_id AND d.correlation_id = i.correlation_id
        ORDER BY d.seq DESC
        LIMIT 1
      ) d ON true
      WHERE i.job_id = ANY(${jobIds}::int[])
      GROUP BY i.job_id
    `;
    return new Map(
      rows.map((row) => [
        row.job_id,
        {
          total: Number(row.total),
          toReview: Number(row.to_review),
          ready: Number(row.ready),
          excluded: Number(row.excluded),
          reprocessing: Number(row.reprocessing),
          reprocessed: Number(row.reprocessed),
          runFailed: Number(row.run_failed),
        },
      ])
    );
  }

  /**
   * Adds the counts every job read that shows a status needs.
   *
   * The caller's runs and these counts are separate queries, so a send run
   * that finishes between them can make one response disagree with itself:
   * runs read while it was running and counts read after it succeeded show
   * `success`, hiding the send's resource errors. The job page stops polling
   * after the full run's `done`, so that can stay on screen until a reload.
   * Accepted: the window is tiny, and nothing stored is affected.
   */
  async withStudentMatchCounts<T extends Pick<Job, 'id'>>(jobs: T[]) {
    const counts = await this.getStudentMatchCounts(jobs.map((job) => job.id));
    return jobs.map((job) => {
      return { ...job, studentMatchCounts: counts.get(job.id) ?? noStudentsToMatch };
    });
  }

  /**
   * The job's students to match, each with their current decision and every
   * run's result for it, and each result's suggestions in order. And the job's
   * send runs, newest first.
   */
  async getStudentMatchResults(jobId: Job['id']) {
    // One snapshot, so the counts, the students and the send runs agree with
    // each other even while students are reported, decided or sent.
    return this.prisma.$transaction(
      async (tx) => {
        const counts =
          (await this.getStudentMatchCounts([jobId], tx as PrismaClient)).get(jobId) ??
          noStudentsToMatch;
        const sendRuns = (
          await tx.run.findMany({
            where: { jobId, kind: 'send' },
            orderBy: { id: 'desc' },
            include: {
              userRunCreatedByIdTouser: true,
              _count: { select: { sendRunDecision: true } },
            },
          })
        ).map(({ userRunCreatedByIdTouser, _count, ...run }) => ({
          ...run,
          createdBy: userRunCreatedByIdTouser,
          studentCount: _count.sendRunDecision,
        }));
        if (counts.total > this.studentMatchReviewLimit) {
          return { counts, students: null, sendRuns };
        }

        const inputs = await tx.studentInputDetails.findMany({
          where: { jobId },
          // Only for a stable order: correlation ids are opaque hashes, so it
          // means nothing to a reviewer.
          orderBy: { correlationId: 'asc' },
          include: {
            studentMatchDecision: {
              orderBy: { seq: 'desc' },
              take: 1,
              include: {
                user: true,
                // The latest send run that delivers the decision.
                sendRunDecision: {
                  orderBy: { runId: 'desc' },
                  take: 1,
                  include: { run: { select: { status: true } } },
                },
              },
            },
            studentMatchResult: {
              orderBy: { runId: 'asc' },
              include: { studentMatchSuggestion: { orderBy: { ordinal: 'asc' } } },
            },
          },
        });
        return {
          counts,
          sendRuns,
          // Prisma names each relation after its table; the API calls them
          // results and suggestions.
          students: inputs.map(({ studentMatchDecision, studentMatchResult, ...input }) => {
            const latest = studentMatchDecision[0] as (typeof studentMatchDecision)[0] | undefined;
            const sendRunDecision = latest?.sendRunDecision[0];
            return {
              ...input,
              status: studentMatchStatus(latest?.kind, sendRunDecision?.run.status),
              sendRunId: sendRunDecision?.runId ?? null,
              decision: latest ? toStudentMatchDecision(latest) : null,
              results: studentMatchResult.map(({ studentMatchSuggestion, ...result }) => ({
                ...result,
                suggestions: studentMatchSuggestion,
              })),
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  /** Appends a decision to the student's history. See AGENTS.md. */
  async decideStudentMatch(
    input: {
      jobId: Job['id'];
      correlationId: string;
      userId: number;
      decision: PostStudentMatchDecisionDto;
    },
    prisma: PrismaClient
  ): Promise<
    | {
        status: 'SUCCESS';
        data: { decision: StudentMatchDecisionWithUser | null };
      }
    | {
        status: 'ERROR';
        code:
          | 'not_found'
          | 'decision_changed'
          | 'already_submitted'
          | 'results_changed'
          | 'invalid_target';
      }
  > {
    const { jobId, correlationId, userId, decision } = input;
    const { replacesVersion, kind } = decision;

    const student = await prisma.studentInputDetails.findUnique({
      where: { jobId_correlationId: { jobId, correlationId } },
      select: {
        // Latest first. A suggestion pick reads its student from these.
        studentMatchResult: {
          select: {
            id: true,
            studentMatchSuggestion: { select: { ordinal: true, studentUniqueId: true } },
          },
          orderBy: { runId: 'desc' },
        },
      },
    });
    if (!student) {
      return { status: 'ERROR', code: 'not_found' };
    }

    // What the row stores beside its kind. Only a match has an answer and a
    // basis, and validation refuses any field the decision's shape doesn't have.
    let columns: DecisionColumns;
    if (restsOnSearch(decision)) {
      // A match to the reviewer's search: the student they found, with the
      // details they searched with and the student as they saw them.
      columns = {
        ...noAnswerOrBasis,
        studentUniqueId: decision.studentUniqueId,
        // Exactly what the search route sends IDRS for these details.
        searchDetails: JSON.stringify(pickStudentSearchDetails(decision.search.searchDetails)),
        rosterDetails: JSON.stringify(decision.search.rosterDetails),
      };
    } else if (restsOnSuggestion(decision)) {
      // A match to a suggestion: its answer is the suggestion's student.
      const results = student.studentMatchResult;
      const picked = results.find(({ id }) => id.toString() === decision.resultId);
      if (!picked) {
        return { status: 'ERROR', code: 'invalid_target' };
      }
      // Reviewers pick from the latest result. A pick from an earlier one
      // means the page predates it. Checked before the insert rather than in
      // it: a result landing in between is harmless, since new results never
      // invalidate a decision already made.
      if (picked !== results[0]) {
        return { status: 'ERROR', code: 'results_changed' };
      }
      const suggestion = picked.studentMatchSuggestion.find(
        ({ ordinal }) => ordinal === decision.ordinal
      );
      if (!suggestion) {
        return { status: 'ERROR', code: 'invalid_target' };
      }
      columns = {
        ...noAnswerOrBasis,
        studentUniqueId: suggestion.studentUniqueId,
        resultId: picked.id,
        ordinal: suggestion.ordinal,
      };
    } else {
      // An exclude or a clear.
      columns = noAnswerOrBasis;
    }

    const outcome = await prisma.$transaction(
      async (tx) => {
        // Once a student is submitted, their current decision is the one their
        // send run delivers. We do not allow decisions to be saved after the
        // student has been submitted, even if their send run fails: they can
        // only be submitted again, with the same decision. The insert below
        // handles this by not inserting when the student has a row in
        // send_run_decision.
        //
        // However, that check alone has a gap. An in-progress submit hasn't
        // committed its send run yet, so a decision could land after the submit
        // checked the decision version and before it commits, and the run would
        // deliver a decision that's no longer current. The job-row lock closes
        // the gap. Submit holds it in FOR NO KEY UPDATE until it commits, and the
        // FOR SHARE we get here waits for that. This ensures that any in-progress
        // submit completes before we proceed with the insert below. And if this
        // decision takes the lock first, the submit waits instead, and then sees
        // the new version and refuses with `decision_changed`.
        //
        // FOR SHARE doesn't block other FOR SHARE holders, so decisions don't
        // wait for each other. Two racing decisions for one student are settled
        // by the insert's primary key.
        await lockJobRow(tx, jobId, 'FOR SHARE');

        // Writes the row after the student's latest, if the caller saw what's
        // current: that latest row for a version, or no decision (no rows, or a
        // clear) for null. A clear needs a decision to clear. A submitted
        // student takes no new decision.
        // Two racing writes compute the same seq, so the loser collides with
        // the winner on the primary key and does nothing.
        const rows = await tx.$queryRaw<{ seq: number }[]>`
        INSERT INTO public.student_match_decision
          (job_id, correlation_id, seq, kind, student_unique_id, result_id, ordinal,
           search_details, roster_details, decided_by_id)
        SELECT ${jobId}::int, ${correlationId}, coalesce(latest.seq, 0) + 1,
               ${kind}::public.student_match_decision_kind, ${columns.studentUniqueId},
               ${columns.resultId}::bigint, ${columns.ordinal}::int,
               ${columns.searchDetails}::jsonb, ${columns.rosterDetails}::jsonb,
               ${userId}::int
        FROM (SELECT 1) AS one
        LEFT JOIN LATERAL (
          SELECT seq, kind FROM public.student_match_decision
          WHERE job_id = ${jobId}::int AND correlation_id = ${correlationId}
          ORDER BY seq DESC
          LIMIT 1
        ) latest ON true
        WHERE CASE
          WHEN ${replacesVersion}::int IS NULL
            THEN (latest.kind IS NULL OR latest.kind = 'clear') AND ${kind} <> 'clear'
          ELSE latest.seq = ${replacesVersion}::int AND latest.kind <> 'clear'
        END
        AND NOT EXISTS (
          SELECT 1 FROM public.send_run_decision s
          WHERE s.job_id = ${jobId}::int AND s.correlation_id = ${correlationId}
        )
        ON CONFLICT (job_id, correlation_id, seq) DO NOTHING
        RETURNING seq
      `;
        if (rows.length > 0) {
          return { status: 'SUCCESS', seq: rows[0].seq } as const;
        }
        const submitted = await tx.sendRunDecision.findFirst({
          where: { jobId, correlationId },
          select: { runId: true },
        });
        return {
          status: 'ERROR',
          code: submitted ? 'already_submitted' : 'decision_changed',
        } as const;
      },
      // Each statement sees what committed before it, so the insert sees a
      // send run committed while this transaction waited at the lock.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );
    if (outcome.status === 'ERROR') {
      return outcome;
    }

    const row = await prisma.studentMatchDecision.findUniqueOrThrow({
      where: { jobId_correlationId_seq: { jobId, correlationId, seq: outcome.seq } },
      include: { user: true },
    });
    return { status: 'SUCCESS', data: { decision: toStudentMatchDecision(row) } };
  }

  /**
   * Searches IDRS for a student with a reviewer's details, and returns the
   * students the job could load. `found` is how many IDRS returned, for the
   * log only.
   */
  async searchStudentMatch(input: {
    job: Job;
    correlationId: string;
    details: StudentSearchDetailsDto;
  }): Promise<
    | {
        status: 'SUCCESS';
        data: {
          students: GetIdrsStudentDto[];
          found: number;
        };
      }
    | { status: 'ERROR'; code: 'not_found' }
    | { status: 'ERROR'; code: 'identity_service_unavailable'; cause: string }
  > {
    const { job, correlationId } = input;

    // The partner's setting is read live, as the Executor's payload reads it,
    // not snapshotted onto the job.
    const student = await this.prisma.studentInputDetails.findUnique({
      where: { jobId_correlationId: { jobId: job.id, correlationId } },
      select: {
        job: {
          select: {
            schoolYear: { select: { endYear: true } },
            tenant: { select: { partner: { select: { crossYearMatchingEnabled: true } } } },
          },
        },
      },
    });
    if (!student) {
      return { status: 'ERROR', code: 'not_found' };
    }
    const { endYear } = student.job.schoolYear;
    const { crossYearMatchingEnabled } = student.job.tenant.partner;

    const result = await this.idrsSearch.searchStudent({
      partnerId: job.partnerId,
      tenantCode: job.tenantCode,
      correlationId,
      details: pickStudentSearchDetails(input.details),
    });
    if (result.status === 'ERROR') {
      return result;
    }

    const students = result.data
      .filter((match) => isLoadableStudent(match, endYear, crossYearMatchingEnabled))
      .map(({ student_unique_id, score, ...rosterDetails }) => ({
        studentUniqueId: student_unique_id,
        score,
        rosterDetails,
      }));
    return { status: 'SUCCESS', data: { students, found: result.data.length } };
  }
}
