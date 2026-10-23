import { pool } from './client';

/**
 * Locks a job's row from another connection, as submit and startJob do, so a
 * race test can queue requests behind it. The test ends the holder's
 * transaction on `client` to let them go. `release` rolls back if the test
 * didn't get that far, and frees the connection.
 */
export const holdJobRow = async (jobId: number) => {
  const client = await pool().connect();
  const release = async () => {
    await client.query('ROLLBACK');
    client.release();
  };
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM public.job WHERE id = $1 FOR NO KEY UPDATE', [jobId]);
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    return { client, pid: rows[0].pid, release };
  } catch (err) {
    await release();
    throw err;
  }
};
