import { ContextIdFactory } from '@nestjs/core';
import type { PrismaClient, User } from '@prisma/client';
import { PRISMA_APP_USER } from 'api/src/database';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA } from '../fixtures/user-fixtures';

// The client a request gets, for a request with or without a logged-in user.
const sessionClient = (user: Pick<User, 'id' | 'email'> | null): Promise<PrismaClient> => {
  const contextId = ContextIdFactory.create();
  app.registerRequestByContextId(user ? { user: { user } } : {}, contextId);
  return app.resolve(PRISMA_APP_USER, contextId, { strict: false });
};

// `prisma` (the test's own client) is another connection throughout.
describe("the session-scoped client's interactive transactions", () => {
  let client: PrismaClient;
  let job: Awaited<ReturnType<typeof seedJob>>;

  beforeEach(async () => {
    client = await sessionClient({ id: userA.id, email: userA.email });
    job = await seedJob({ odsConfig: odsConfigA2425, bundle: bundleA, tenant: tenantA });
  });

  it('keep their writes from other connections until they commit', async () => {
    let seenOutside: number | undefined;
    await client.$transaction(async (tx) => {
      await tx.run.create({ data: { jobId: job.id, kind: 'full', status: 'new' } });
      seenOutside = await prisma.run.count({ where: { jobId: job.id } });
    });

    expect(seenOutside).toBe(1);
    expect(await prisma.run.count({ where: { jobId: job.id } })).toBe(2);
  });

  it('hold their row locks until they commit', async () => {
    let lockedOutside: Promise<number> | undefined;
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM job WHERE id = ${job.id} FOR NO KEY UPDATE`;
      lockedOutside = prisma.$executeRaw`SELECT id FROM job WHERE id = ${job.id} FOR NO KEY UPDATE NOWAIT`;
      await lockedOutside.catch(() => undefined);
    });

    await expect(lockedOutside).rejects.toMatchObject({ meta: { code: '55P03' } });
  });

  it('roll back their writes when they throw', async () => {
    const failure = new Error('fails after the insert');
    await expect(
      client.$transaction(async (tx) => {
        await tx.run.create({ data: { jobId: job.id, kind: 'full', status: 'new' } });
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(await prisma.run.count({ where: { jobId: job.id } })).toBe(1);
  });

  it('attribute their writes to the session user', async () => {
    const run = await client.$transaction(async (tx) =>
      tx.run.create({ data: { jobId: job.id, kind: 'full', status: 'new' } })
    );

    expect(run.createdById).toBe(userA.id);
  });

  it('are refused without a logged-in user', async () => {
    const anonymous = await sessionClient(null);

    await expect(anonymous.$transaction(async (tx) => tx.run.count())).rejects.toThrow(
      'Trouble connecting to the database'
    );
  });
});

// Each operation sets the user in its own transaction, so an array's
// operations would commit one by one, on different connections.
describe("the session-scoped client's array transactions", () => {
  it('are refused, and run nothing', async () => {
    const client = await sessionClient({ id: userA.id, email: userA.email });
    const job = await seedJob({ odsConfig: odsConfigA2425, bundle: bundleA, tenant: tenantA });

    await expect(
      client.$transaction([client.run.deleteMany({ where: { jobId: job.id } })])
    ).rejects.toThrow("Array-style transactions aren't supported on the session client");
    expect(await prisma.run.count({ where: { jobId: job.id } })).toBe(1);
  });
});
