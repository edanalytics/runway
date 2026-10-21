import { lockJobRow } from 'api/src/jobs/job-row-lock';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA } from '../fixtures/context-fixtures/tenant-fixtures';
import { pool } from '../helpers/db/client';

// Submit, startJob and decisions hold the job row while they check and write.
// The Executor keeps posting results meanwhile, and must not wait for them.
describe('the job-row lock', () => {
  it.each(['FOR NO KEY UPDATE', 'FOR SHARE'] as const)(
    'taken %s, lets the Executor ingest the job’s results',
    async (strength) => {
      const job = await seedJob({ odsConfig: odsConfigA2425, bundle: bundleA, tenant: tenantA });
      const ingestion = await pool().connect();
      try {
        await prisma.$transaction(async (tx) => {
          await lockJobRow(tx, job.id, strength);
          // Ingestion's first write. Its foreign key to the job takes a key
          // share lock on the row, which FOR UPDATE would block.
          await ingestion.query('BEGIN');
          await ingestion.query("SET LOCAL lock_timeout = '1s'");
          await ingestion.query(
            `INSERT INTO public.student_input_details
               (job_id, correlation_id, source_run_id, input_details)
             VALUES ($1, 'corr-1', $2, '{}')`,
            [job.id, job.runs[0].id]
          );
          await ingestion.query('COMMIT');
        });
      } finally {
        await ingestion.query('ROLLBACK');
        ingestion.release();
      }

      expect(await prisma.studentInputDetails.count({ where: { jobId: job.id } })).toBe(1);
    }
  );
});
