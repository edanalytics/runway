import { pool } from './client';

/**
 * Waits until `waiters` backends are queued behind backend `pid` (the holder).
 * A race test holds a job row's lock from its own connection, sends requests
 * that will queue behind it, and calls this before releasing the lock, so the
 * requests run in a known order.
 *
 * The first request to queue (A) takes the row's tuple lock, its place in
 * line, and waits on the holder's transaction; the next (B) waits on A's tuple
 * lock:
 *
 *   pg_blocking_pids(A) = {holder}
 *   pg_blocking_pids(B) = {A}
 *
 * Counting only the holder's direct waiters would see A and return before B
 * has queued. So the recursive query starts from the backends blocked by the
 * holder, then adds each backend blocked by one already found, until a round
 * adds none; `UNION` keeps each backend once, which ends the recursion. It
 * counts every backend in the database waiting on the holder, which is fine in
 * the test DB, where nothing else runs.
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
