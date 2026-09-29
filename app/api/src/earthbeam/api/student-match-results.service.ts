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
   * A retry re-sends what is already stored, so the first report of a group
   * wins and the retry is a no-op. Results are per run, so a later search adds
   * history instead of overwriting. See AGENTS.md.
   */
  private persist(
    runId: number,
    records: EarthbeamApiStudentMatchResultDto[]
  ): Promise<IngestResult> {
    // PostgreSQL parses scores from this text straight to numeric, rather than
    // through a Prisma Decimal.
    const payload = JSON.stringify(records);

    return this.prisma.$transaction(async (tx): Promise<IngestResult> => {
      // 1. The job comes from the authenticated run, never the body.
      const run = await tx.run.findUnique({ where: { id: runId }, select: { jobId: true } });
      if (!run) {
        return { status: 'ERROR', code: 'NOT_FOUND' };
      }
      const { jobId } = run;

      // 2. Store each group's input details.
      const inputs = await tx.$executeRaw`
        INSERT INTO public.student_input_details
          (job_id, correlation_id, source_run_id, input_details)
        SELECT ${jobId}, entry.correlation_id, ${runId}, entry.candidate
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS entry(correlation_id text, candidate jsonb)
        ON CONFLICT (job_id, correlation_id) DO NOTHING
      `;

      // 3. Record this run's result for each group, getting back the ids its
      // suggestions will reference. (A retry's results already exist, so none
      // come back and step 4 adds nothing.)
      const results = await tx.$queryRaw<{ id: bigint; correlation_id: string }[]>`
        INSERT INTO public.student_match_result (job_id, correlation_id, run_id)
        SELECT ${jobId}, entry.correlation_id, ${runId}
        FROM jsonb_to_recordset(${payload}::jsonb) AS entry(correlation_id text)
        ON CONFLICT (job_id, correlation_id, run_id) DO NOTHING
        RETURNING id, correlation_id
      `;
      const resultIds = JSON.stringify(
        results.map((r) => ({ correlation_id: r.correlation_id, result_id: r.id.toString() }))
      );

      // 4. Store each result's suggestions. A match's position in `matches` is
      // its ordinal, and the match minus its two column fields is its roster
      // details.
      const suggestions = await tx.$executeRaw`
        INSERT INTO public.student_match_suggestion
          (result_id, ordinal, student_unique_id, roster_details, score)
        SELECT ids.result_id,
               m.ordinality - 1,
               m.match->>'student_unique_id',
               m.match - 'student_unique_id' - 'score',
               (m.match->>'score')::numeric
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS entry(correlation_id text, matches jsonb)
        JOIN jsonb_to_recordset(${resultIds}::jsonb)
          AS ids(correlation_id text, result_id bigint)
          ON ids.correlation_id = entry.correlation_id
        CROSS JOIN LATERAL jsonb_array_elements(entry.matches) WITH ORDINALITY AS m(match, ordinality)
      `;

      return { status: 'SUCCESS', data: { inputs, results: results.length, suggestions } };
    });
  }
}
