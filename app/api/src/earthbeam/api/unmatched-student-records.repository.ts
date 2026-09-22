import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { NormalizedRecord } from './unmatched-student-records.pipe';

/**
 * Thrown inside the transaction when submitted content disagrees with content
 * already accepted. Private on purpose: returning an error value from inside the
 * callback would commit the inserts made before it. Throwing rolls the whole
 * request back.
 */
class IngestionConflict extends Error {
  constructor() {
    super('ingestion conflict');
    this.name = 'IngestionConflict';
  }
}

export type IngestionOutcome = 'SUCCESS' | 'NOT_FOUND' | 'CONFLICT';

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
   * Uniqueness and the transaction do the enforcing; a read-then-insert check
   * would not survive concurrent retries. `ON CONFLICT DO NOTHING` here only
   * means "do not insert twice" — it is never permission to accept differing
   * content, which the explicit SQL comparisons below reject.
   */
  async ingest(runId: number, records: NormalizedRecord[]): Promise<IngestionOutcome> {
    const payload = JSON.stringify(records.map(toSqlRecord));

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Lock the job for the duration. Every ingestion for a job takes this
        // lock first, so concurrent batches for one job serialize while
        // different jobs proceed independently. Ownership comes from the
        // authenticated run — never from a body field.
        const owner = await tx.$queryRaw<{ job_id: number }[]>`
          SELECT j.id AS job_id
          FROM public.run r
          JOIN public.job j ON j.id = r.job_id
          WHERE r.id = ${runId}
          FOR UPDATE OF j
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

        // 3. Compare submitted input against what is stored. The Executor
        // derives correlation ids from lowercased details, so comparing
        // lowercased JSON text keeps a case-variant retry a no-op while the
        // first accepted spelling stays untouched. Reading it back as jsonb
        // makes object key order irrelevant without making array order or
        // missing-versus-null irrelevant.
        const inputMismatches = await tx.$queryRaw<{ mismatches: number }[]>`
          SELECT count(*)::int AS mismatches
          FROM jsonb_to_recordset(${payload}::jsonb)
            AS e(correlation_id text, input_details jsonb)
          JOIN public.student_input_details s
            ON s.job_id = ${jobId}::int AND s.correlation_id = e.correlation_id
          WHERE lower(s.input_details::text)::jsonb
                IS DISTINCT FROM lower(e.input_details::text)::jsonb
        `;
        if (inputMismatches[0].mismatches > 0) {
          throw new IngestionConflict();
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

        // 6. Compare every submitted group's complete ordered suggestion set
        // against what is persisted for this run — ordinal, canonical id,
        // roster details and score, including count and order. Aggregating in
        // SQL avoids JS key-order and Decimal round trips, and coalescing to an
        // empty array catches empty-to-nonempty and nonempty-to-empty retries
        // rather than silently ignoring a result with no children.
        const suggestionMismatches = await tx.$queryRaw<{ mismatches: number }[]>`
          WITH e AS (
            SELECT * FROM jsonb_to_recordset(${payload}::jsonb)
              AS x(correlation_id text, suggestions jsonb)
          ),
          incoming AS (
            SELECT e.correlation_id,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_array(
                         (s->>'ordinal')::int,
                         s->>'student_unique_id',
                         s->'roster_details',
                         (s->>'score')::numeric
                       ) ORDER BY (s->>'ordinal')::int)
                FROM jsonb_array_elements(e.suggestions) s
              ), '[]'::jsonb) AS agg
            FROM e
          ),
          persisted AS (
            SELECT e.correlation_id,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_array(
                         g.ordinal, g.student_unique_id, g.roster_details, g.score
                       ) ORDER BY g.ordinal)
                FROM public.student_match_result r
                JOIN public.student_match_suggestion g ON g.result_id = r.id
                WHERE r.job_id = ${jobId}::int
                  AND r.correlation_id = e.correlation_id
                  AND r.run_id = ${runId}::int
              ), '[]'::jsonb) AS agg
            FROM e
          )
          SELECT count(*)::int AS mismatches
          FROM incoming i
          JOIN persisted p ON p.correlation_id = i.correlation_id
          WHERE i.agg IS DISTINCT FROM p.agg
        `;
        if (suggestionMismatches[0].mismatches > 0) {
          throw new IngestionConflict();
        }

        return 'SUCCESS';
      });
    } catch (err) {
      // Only a content disagreement becomes a 409. Lock waits, timeouts and
      // other operational failures are not conflicts and propagate.
      if (err instanceof IngestionConflict) {
        return 'CONFLICT';
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
