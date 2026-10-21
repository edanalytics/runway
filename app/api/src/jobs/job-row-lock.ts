import { Prisma } from '@prisma/client';
import type { Job } from '@prisma/client';

/**
 * Locks the job's row until the transaction ends. Everything that creates a
 * job's runs or writes its decisions takes this lock first, so nothing its
 * checks rely on changes before it commits (see AGENTS.md, Submitting):
 * - creating runs, as submit and startJob do, takes `FOR NO KEY UPDATE`, which
 *   waits out every other holder;
 * - writing a decision takes `FOR SHARE`, which waits out runs being created
 *   but not other decisions. The primary key settles a race between those.
 *
 * Never FOR UPDATE, which would also block inserts that reference the job,
 * such as ingestion's.
 */
export const lockJobRow = (
  tx: Prisma.TransactionClient,
  jobId: Job['id'],
  strength: 'FOR NO KEY UPDATE' | 'FOR SHARE'
) => tx.$executeRaw`SELECT id FROM public.job WHERE id = ${jobId}::int ${Prisma.raw(strength)}`;
