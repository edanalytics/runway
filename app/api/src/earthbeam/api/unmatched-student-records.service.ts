import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PRISMA_ANONYMOUS } from 'api/src/database';

type Written = { inputs: number; results: number; suggestions: number };

export type IngestResult =
  | { status: 'SUCCESS'; data: Written }
  | { status: 'ERROR'; code: 'NOT_FOUND' };

@Injectable()
export class UnmatchedStudentRecordsService {
  private readonly logger = new Logger(UnmatchedStudentRecordsService.name);

  constructor(@Inject(PRISMA_ANONYMOUS) private readonly prisma: PrismaClient) {}

  async ingest(runId: number, body: unknown): Promise<IngestResult> {
    const startedAt = Date.now();
    const records = Array.isArray(body) ? body.length : 'not-an-array';

    try {
      const result = await this.persist(runId, body);
      // Counts and identifiers only — never correlation ids, names or any other
      // detail under review.
      this.logger.log(
        `unmatched student records: runId=${runId} records=${records} ` +
          (result.status === 'SUCCESS'
            ? `outcome=SUCCESS inputs=${result.data.inputs} results=${result.data.results} ` +
              `suggestions=${result.data.suggestions}`
            : `outcome=${result.code}`) +
          ` durationMs=${Date.now() - startedAt}`
      );
      return result;
    } catch (err) {
      // The database is what rejects a malformed payload, so its SQLSTATE is
      // the diagnosis. Never log the error's message or meta.message: a
      // constraint violation's detail quotes the failing row, which is
      // student data.
      const sqlstate =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        typeof err.meta?.code === 'string'
          ? ` sqlstate=${err.meta.code}`
          : '';
      this.logger.error(
        `unmatched student records: runId=${runId} records=${records} outcome=FAILED ` +
          `durationMs=${Date.now() - startedAt} cause=${
            err instanceof Error ? err.name : 'unknown'
          }${sqlstate}`
      );
      throw err;
    }
  }

  /**
   * Write one batch atomically, exactly as the Executor sent it.
   *
   * Nothing is validated in the app. Every field that lands in a column is
   * guarded by that column's constraints — correlation ids by NOT NULL and a
   * length CHECK, candidates by NOT NULL and an object CHECK, each match's
   * student_unique_id and score by theirs — and any violation rolls the whole
   * request back. The one thing that lands nowhere, the matches array itself,
   * is guarded in step 4. Values are stored as sent, including keys the app
   * does not read yet.
   *
   * The transaction is there for atomicity: the three inserts are individually
   * atomic, but a failure between them would leave a result row with no
   * suggestions — indistinguishable from a genuine no-match, and permanent,
   * since a retry inserts nothing.
   *
   * Within a run, the first report of a group is authoritative: a retry is a
   * no-op, and `ON CONFLICT DO NOTHING` is what makes it one. New evidence for
   * the same input comes from a new run, which gets its own result row. A
   * re-send carrying different suggestions under the same run is therefore
   * ignored rather than rejected — see AGENTS.md for why that is not worth
   * detecting.
   */
  private persist(runId: number, body: unknown): Promise<IngestResult> {
    // Scores go through JSON.stringify once and PostgreSQL parses that text
    // straight to numeric, so they never pass through a Prisma Decimal. A
    // missing body becomes JSON null, which the recordset calls reject.
    const payload = JSON.stringify(body ?? null);

    return this.prisma.$transaction(async (tx): Promise<IngestResult> => {
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
        return { status: 'ERROR', code: 'NOT_FOUND' };
      }
      const jobId = owner[0].job_id;

      // 2. Insert input details for groups this job has not seen before.
      // jsonb_to_recordset rejects a body that is not an array of objects.
      const inputs = await tx.$executeRaw`
        INSERT INTO public.student_input_details
          (job_id, correlation_id, source_run_id, input_details)
        SELECT ${jobId}::int, e.correlation_id, ${runId}::int, e.candidate
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS e(correlation_id text, candidate jsonb)
        ON CONFLICT (job_id, correlation_id) DO NOTHING
      `;

      // 3. One result per (input group, run). A retry of the same run inserts
      // nothing and is remembered as such, so step 4 cannot give an already
      // accepted result a second set of children.
      const inserted = await tx.$queryRaw<{ id: bigint; correlation_id: string }[]>`
        INSERT INTO public.student_match_result (job_id, correlation_id, run_id)
        SELECT ${jobId}::int, e.correlation_id, ${runId}::int
        FROM jsonb_to_recordset(${payload}::jsonb) AS e(correlation_id text)
        ON CONFLICT (job_id, correlation_id, run_id) DO NOTHING
        RETURNING id, correlation_id
      `;

      // 4. Suggestions, for newly inserted results only, in one statement. The
      // ordinal is the match's zero-based position in the array, and roster
      // details are the match as sent, minus its two column fields.
      //
      // The COALESCE is the one guard no column can provide. A missing or null
      // matches would otherwise expand to zero rows and be stored as "IDRS
      // found nothing"; as JSON null it makes jsonb_array_elements fail
      // instead, as a non-array already does. Two records sharing a
      // correlation id cannot interleave their matches either: both would
      // claim ordinal 0 under the one result and violate its primary key.
      let suggestions = 0;
      if (inserted.length > 0) {
        const newResults = JSON.stringify(
          inserted.map((r) => ({ correlation_id: r.correlation_id, result_id: r.id.toString() }))
        );
        suggestions = await tx.$executeRaw`
          INSERT INTO public.student_match_suggestion
            (result_id, ordinal, student_unique_id, roster_details, score)
          SELECT n.result_id,
                 (m.ordinality - 1)::int,
                 m.match->>'student_unique_id',
                 m.match - 'student_unique_id' - 'score',
                 (m.match->>'score')::numeric
          FROM jsonb_to_recordset(${payload}::jsonb)
            AS e(correlation_id text, matches jsonb)
          JOIN jsonb_to_recordset(${newResults}::jsonb)
            AS n(correlation_id text, result_id bigint)
            ON n.correlation_id = e.correlation_id
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.matches, 'null'))
            WITH ORDINALITY AS m(match, ordinality)
        `;
      }

      return { status: 'SUCCESS', data: { inputs, results: inserted.length, suggestions } };
    });
  }
}
