import { Prisma } from '@prisma/client';
import type { Run, RunStatus } from '@prisma/client';

/**
 * Moves a run's status from `from` to `to`, returning the updated run, or null
 * if the run wasn't in `from`. It's one conditional statement, so of two
 * racing writers only the first passes. `update`, not `updateMany`, so an
 * undefined id throws rather than widening the update to every run in `from`.
 */
export async function advanceRunStatus(
  tx: Prisma.TransactionClient,
  runId: Run['id'],
  from: RunStatus | RunStatus[],
  to: RunStatus
): Promise<Run | null> {
  try {
    return await tx.run.update({
      where: { id: runId, status: Array.isArray(from) ? { in: from } : from },
      data: { status: to },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return null;
    }
    throw e;
  }
}
