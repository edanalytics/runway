import { pool } from './client';

/**
 * Locks a row from another connection, so a race test can queue requests
 * behind it. The test ends the holder's transaction on `client` to let them
 * go. `release` rolls back if the test didn't get that far, and frees the
 * connection.
 */
const holdRow = async (table: 'job' | 'run', id: number) => {
  const client = await pool().connect();
  const release = async () => {
    await client.query('ROLLBACK');
    client.release();
  };
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM public.${table} WHERE id = $1 FOR NO KEY UPDATE`, [id]);
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    return { client, pid: rows[0].pid, release };
  } catch (err) {
    await release();
    throw err;
  }
};

/** Locks a job's row, as submit and startJob do. */
export const holdJobRow = (jobId: number) => holdRow('job', jobId);

/** Locks a run's row, as updating its status does. */
export const holdRunRow = (runId: number) => holdRow('run', runId);
