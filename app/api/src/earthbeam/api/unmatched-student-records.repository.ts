import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { NormalizedRecord } from './unmatched-student-records.pipe';

export type IngestionOutcome = 'SUCCESS' | 'NOT_FOUND' | 'MULTIPLE_EXTRACTION_RUNS';

/**
 * Thrown inside the transaction so the whole request rolls back. Returning an
 * outcome from the callback instead would commit the inserts made before it.
 */
class ExtractionRunConflict extends Error {
  constructor() {
    super('input details for this job were established by a different run');
    this.name = 'ExtractionRunConflict';
  }
}

/**
 * The JSON payload handed to PostgreSQL. Scores travel as strings so the exact
 * decimal text of the parsed JSON number reaches numeric without a round trip
 * through a JS float or a Prisma Decimal.
 */
interface SqlRecord {
  correlation_id: string;
  input_details: Record<string, unknown>;
  suggestions: {
    ordinal: number;
    student_unique_id: string;
    roster_details: Record<string, unknown>;
    score: string;
  }[];
}

@Injectable()
export class UnmatchedStudentRecordsRepository {
  constructor(@Inject(PRISMA_ANONYMOUS) private readonly prisma: PrismaClient) {}

  /**
   * Ingest one batch atomically.
   *
   * The transaction is here for atomicity alone. The three inserts below are
   * individually atomic, but a failure between them would leave a result row
   * with no suggestions — indistinguishable from a genuine no-match, and
   * permanent, since a retry inserts nothing.
   *
   * Within a run, the first report of a group is authoritative: a retry is a
   * no-op, and `ON CONFLICT DO NOTHING` is what makes it one. New evidence for
   * the same input comes from a new run, which gets its own result row. A
   * re-send carrying different suggestions under the same run is therefore
   * ignored rather than rejected — see AGENTS.md for why that is not worth
   * detecting.
   */
  async ingest(runId: number, records: NormalizedRecord[]): Promise<IngestionOutcome> {
    const payload = JSON.stringify(records.map(toSqlRecord));

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Resolve the owning job. Ownership comes from the authenticated
        // run — never from a body field. No row lock: the Executor sends a
        // run's batches sequentially, and input details are extracted only on a
        // job's first run, so no two requests ever insert the same input or
        // result row concurrently. Uniqueness and this transaction carry the
        // rest.
        const owner = await tx.$queryRaw<{ job_id: number }[]>`
        SELECT j.id AS job_id
        FROM public.run r
        JOIN public.job j ON j.id = r.job_id
        WHERE r.id = ${runId}
      `;
        if (owner.length === 0) {
          return 'NOT_FOUND';
        }
        const jobId = owner[0].job_id;

        // 2. Insert input details for groups this job has not seen before.
        await tx.$executeRaw`
        INSERT INTO public.student_input_details
          (job_id, correlation_id, source_run_id, input_details)
        SELECT ${jobId}::int, e.correlation_id, ${runId}::int, e.input_details
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS e(correlation_id text, input_details jsonb)
        ON CONFLICT (job_id, correlation_id) DO NOTHING
      `;

        // 3. A job's input details are established by exactly one run: the
        // Executor extracts them on the first run and later runs re-report the
        // same groups. A second run creating an input row therefore means a fresh
        // extraction — which belongs to a new job — or a bug, and would silently
        // attach this run's matches to another run's observables. This is a
        // structural check on provenance, so it stays correct however the
        // Executor normalizes the details it hashes.
        const extraction = await tx.$queryRaw<{ runs: number }[]>`
        SELECT count(DISTINCT source_run_id)::int AS runs
        FROM public.student_input_details
        WHERE job_id = ${jobId}::int
      `;
        if (extraction[0].runs > 1) {
          throw new ExtractionRunConflict();
        }

        // 4. One result per (input group, run). A retry of the same run inserts
        // nothing and is remembered as such, so step 5 cannot give an already
        // accepted result a second set of children.
        const inserted = await tx.$queryRaw<{ id: bigint; correlation_id: string }[]>`
        INSERT INTO public.student_match_result (job_id, correlation_id, run_id)
        SELECT ${jobId}::int, e.correlation_id, ${runId}::int
        FROM jsonb_to_recordset(${payload}::jsonb) AS e(correlation_id text)
        ON CONFLICT (job_id, correlation_id, run_id) DO NOTHING
        RETURNING id, correlation_id
      `;

        // 5. Suggestions, for newly inserted results only, in one statement.
        if (inserted.length > 0) {
          const newResults = JSON.stringify(
            inserted.map((r) => ({ correlation_id: r.correlation_id, result_id: r.id.toString() }))
          );
          await tx.$executeRaw`
          INSERT INTO public.student_match_suggestion
            (result_id, ordinal, student_unique_id, roster_details, score)
          SELECT n.result_id,
                 (s->>'ordinal')::int,
                 s->>'student_unique_id',
                 s->'roster_details',
                 (s->>'score')::numeric
          FROM jsonb_to_recordset(${payload}::jsonb)
            AS e(correlation_id text, suggestions jsonb)
          JOIN jsonb_to_recordset(${newResults}::jsonb)
            AS n(correlation_id text, result_id bigint)
            ON n.correlation_id = e.correlation_id
          CROSS JOIN LATERAL jsonb_array_elements(e.suggestions) s
        `;
        }

        return 'SUCCESS';
      });
    } catch (err) {
      if (err instanceof ExtractionRunConflict) {
        return 'MULTIPLE_EXTRACTION_RUNS';
      }
      throw err;
    }
  }
}

const toSqlRecord = (record: NormalizedRecord): SqlRecord => ({
  correlation_id: record.correlationId,
  input_details: record.inputDetails,
  suggestions: record.suggestions.map((s) => ({
    ordinal: s.ordinal,
    student_unique_id: s.studentUniqueId,
    roster_details: s.rosterDetails,
    score: String(s.score),
  })),
});
