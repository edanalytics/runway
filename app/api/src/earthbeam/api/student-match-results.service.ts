import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { EarthbeamApiStudentMatchResultDto } from '@edanalytics/models';

type Written = { inputs: number; results: number; suggestions: number };

export type IngestResult =
  | { status: 'SUCCESS'; data: Written }
  | { status: 'ERROR'; code: 'NOT_FOUND' };

@Injectable()
export class StudentMatchResultsService {
  private readonly logger = new Logger(StudentMatchResultsService.name);

  constructor(@Inject(PRISMA_ANONYMOUS) private readonly prisma: PrismaClient) {}

  async ingest(runId: number, records: EarthbeamApiStudentMatchResultDto[]): Promise<IngestResult> {
    const startedAt = Date.now();

    try {
      const result = await this.persist(runId, records);
      // Counts and identifiers only — never correlation ids, names or any other
      // detail under review.
      this.logger.log(
        `student match results: runId=${runId} records=${records.length} ` +
          (result.status === 'SUCCESS'
            ? `outcome=SUCCESS inputs=${result.data.inputs} results=${result.data.results} ` +
              `suggestions=${result.data.suggestions}`
            : `outcome=${result.code}`) +
          ` durationMs=${Date.now() - startedAt}`
      );
      return result;
    } catch (err) {
      // Log the SQLSTATE, never the message or meta.message: a constraint
      // violation's detail quotes the failing row, which is student data.
      const sqlstate =
        err instanceof Prisma.PrismaClientKnownRequestError && typeof err.meta?.code === 'string'
          ? ` sqlstate=${err.meta.code}`
          : '';
      this.logger.error(
        `student match results: runId=${runId} records=${records.length} outcome=FAILED ` +
          `durationMs=${Date.now() - startedAt} cause=${
            err instanceof Error ? err.name : 'unknown'
          }${sqlstate}`
      );
      throw err;
    }
  }

  /**
   * Stores the batch as sent, in one transaction: a failure between the three
   * inserts would otherwise leave a result with no suggestions, which looks
   * like a genuine no-match and which a retry cannot repair.
   *
   * Within a run the first report of a group wins, so a retry is a no-op even
   * if its content differs; new evidence arrives as a new run. See AGENTS.md.
   */
  private persist(
    runId: number,
    records: EarthbeamApiStudentMatchResultDto[]
  ): Promise<IngestResult> {
    // PostgreSQL parses scores from this text straight to numeric, rather than
    // through a Prisma Decimal.
    const payload = JSON.stringify(records);

    return this.prisma.$transaction(async (tx): Promise<IngestResult> => {
      // 1. The owning job comes from the authenticated run, never the body.
      // No row lock: a run's batches arrive in sequence, and the unique
      // constraints keep overlapping runs consistent.
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
      const inputs = await tx.$executeRaw`
        INSERT INTO public.student_input_details
          (job_id, correlation_id, source_run_id, input_details)
        SELECT ${jobId}::int, e.correlation_id, ${runId}::int, e.candidate
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS e(correlation_id text, candidate jsonb)
        ON CONFLICT (job_id, correlation_id) DO NOTHING
      `;

      // 3. One result per (input group, run). A retry inserts none, so step 4
      // cannot give an already stored result a second set of suggestions.
      const inserted = await tx.$queryRaw<{ id: bigint; correlation_id: string }[]>`
        INSERT INTO public.student_match_result (job_id, correlation_id, run_id)
        SELECT ${jobId}::int, e.correlation_id, ${runId}::int
        FROM jsonb_to_recordset(${payload}::jsonb) AS e(correlation_id text)
        ON CONFLICT (job_id, correlation_id, run_id) DO NOTHING
        RETURNING id, correlation_id
      `;

      // 4. Suggestions for new results only. The ordinal is the match's
      // zero-based position; roster details are the match minus its two column
      // fields. Two records sharing a correlation id cannot mix their matches:
      // both claim ordinal 0 under the one result and violate its primary key.
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
          CROSS JOIN LATERAL jsonb_array_elements(e.matches) WITH ORDINALITY AS m(match, ordinality)
        `;
      }

      return { status: 'SUCCESS', data: { inputs, results: inserted.length, suggestions } };
    });
  }
}
