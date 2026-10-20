import { pool } from './client';

/**
 * Waits until `waiters` backends are blocked by backend `pid`: the requests a
 * race test has sent are all queued behind the lock it holds.
 */
export const waitUntilBlockedBy = async (pid: number, waiters = 1) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rowCount } = await pool().query(
      'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [pid]
    );
    if ((rowCount ?? 0) >= waiters) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Fewer than ${waiters} backends waited on backend ${pid}`);
};
