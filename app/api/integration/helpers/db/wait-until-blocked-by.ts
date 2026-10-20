import { pool } from './client';

/**
 * Waits until `waiters` backends are blocked by backend `pid`: the requests a
 * race test has sent are all queued behind the lock it holds. A backend
 * queued behind another waiter for the same row counts too, since PostgreSQL
 * reports it as blocked by that waiter rather than by the holder.
 */
export const waitUntilBlockedBy = async (pid: number, waiters = 1) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await pool().query<{ blocked: number }>(
      `WITH RECURSIVE blocked (pid) AS (
         SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
         UNION
         SELECT a.pid FROM pg_stat_activity a
         JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
       )
       SELECT count(*)::int AS blocked FROM blocked`,
      [pid]
    );
    if (rows[0].blocked >= waiters) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Fewer than ${waiters} backends waited on backend ${pid}`);
};
