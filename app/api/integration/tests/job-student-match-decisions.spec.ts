import request from 'supertest';
import { IdMatchingMode, Run } from '@prisma/client';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigB2526 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantB, tenantDGlobal } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB } from '../fixtures/user-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { GetSessionDataDto, PrivilegeKey } from '@edanalytics/models';
import { reportMatchResults } from '../helpers/report-match-results';

describe('POST /jobs/:jobId/student-match-results/:correlationId/decisions', () => {
  const PARTNER_ADMIN = ['runway.test.user', 'runway.test.partneradmin'];
  const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];

  let job: Awaited<ReturnType<typeof seedJob>>;
  let run: Run;
  /** corr-1's result, with suggestions at ordinals 0 and 1. */
  let resultId: string;
  /** corr-2's result, with one suggestion at ordinal 0. */
  let otherResultId: string;
  let cookies: string;

  /** A job in this mode, with corr-1 and corr-2 reported for its first run. */
  const seedReportedJob = async (idMatchingMode: IdMatchingMode, inTenantB = false) => {
    const seeded = await seedJob({
      odsConfig: inTenantB ? odsConfigB2526 : odsConfigA2425,
      bundle: bundleA,
      tenant: inTenantB ? tenantB : tenantA,
      idMatchingMode,
    });
    await reportMatchResults(seeded.runs[0].id, [
      {
        correlation_id: 'corr-1',
        candidate: { first_name: 'Ada' },
        matches: [
          { student_unique_id: 'SUID-1', score: 0.9 },
          { student_unique_id: 'SUID-2', score: 0.4 },
        ],
      },
      {
        correlation_id: 'corr-2',
        candidate: { first_name: 'Grace' },
        matches: [{ student_unique_id: 'SUID-3', score: 0.8 }],
      },
    ]);
    return seeded;
  };

  const resultIdOf = async (jobId: number, correlationId: string, runId: number) =>
    (
      await prisma.studentMatchResult.findUniqueOrThrow({
        where: { jobId_correlationId_runId: { jobId, correlationId, runId } },
      })
    ).id.toString();

  const decide = (
    body: Record<string, unknown>,
    { jobId = job.id, correlationId = 'corr-1', cookie = cookies } = {}
  ) =>
    request(app.getHttpServer())
      .post(`/jobs/${jobId}/student-match-results/${correlationId}/decisions`)
      .set('Cookie', cookie ? [cookie] : [])
      .send(body);

  /** The student's decision rows, as stored, in order. */
  const rowsOf = (correlationId = 'corr-1', jobId = job.id) =>
    prisma.studentMatchDecision.findMany({
      where: { jobId, correlationId },
      orderBy: { seq: 'asc' },
    });

  const matchFirst = () => decide({ version: 0, kind: 'match', resultId, ordinal: 0 });

  beforeEach(async () => {
    job = await seedReportedJob('fuzzy');
    run = job.runs[0];
    resultId = await resultIdOf(job.id, 'corr-1', run.id);
    otherResultId = await resultIdOf(job.id, 'corr-2', run.id);
    ({ cookies } = await authHelper.login(idpA, userA, tenantA));
  });

  describe('authentication and authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await decide({ version: 0, kind: 'exclude' }, { cookie: '' });

      expect(res.status).toBe(401);
      expect(await rowsOf()).toEqual([]);
    });

    it('rejects a user from another tenant', async () => {
      const { cookies: other } = await authHelper.login(idpA, userB, tenantB);

      const res = await decide({ version: 0, kind: 'exclude' }, { cookie: other });

      expect(res.status).toBe(403);
      expect(await rowsOf()).toEqual([]);
    });

    it('rejects a user without the match results update privilege', async () => {
      // Every role has it, so take it from the session.
      const { get } = Object.getOwnPropertyDescriptor(GetSessionDataDto.prototype, 'privileges')!;
      const privileges = jest
        .spyOn(GetSessionDataDto.prototype, 'privileges', 'get')
        .mockImplementation(function (this: GetSessionDataDto) {
          const granted: Set<PrivilegeKey> = get!.call(this);
          granted.delete('job.match-results.update');
          return granted;
        });
      try {
        const res = await decide({ version: 0, kind: 'exclude' });

        expect(res.status).toBe(403);
        expect(await rowsOf()).toEqual([]);
      } finally {
        privileges.mockRestore();
      }
    });

    it('lets a support user decide across tenants', async () => {
      const tenantBJob = await seedReportedJob('fuzzy', true);
      const { cookies: support } = await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_USER);

      const res = await decide(
        { version: 0, kind: 'exclude' },
        { jobId: tenantBJob.id, cookie: support }
      );

      expect(res.status).toBe(201);
      expect(await rowsOf('corr-1', tenantBJob.id)).toHaveLength(1);
    });
  });

  describe('by matching mode', () => {
    it.each<IdMatchingMode>(['id_based_fuzzy_background', 'id_based'])(
      'refuses a %s job, even to a partner admin',
      async (mode) => {
        const other = await seedReportedJob(mode);
        const { cookies: admin } = await authHelper.login(idpA, userA, tenantA, PARTNER_ADMIN);

        const res = await decide(
          { version: 0, kind: 'exclude' },
          { jobId: other.id, cookie: admin }
        );

        expect(res.status).toBe(403);
        expect(await rowsOf('corr-1', other.id)).toEqual([]);
      }
    );
  });

  it('returns 404 for a student the job doesn’t have', async () => {
    const res = await decide({ version: 0, kind: 'exclude' }, { correlationId: 'corr-unknown' });

    expect(res.status).toBe(404);
    expect(await rowsOf('corr-unknown')).toEqual([]);
  });

  describe('a bad request', () => {
    it.each<[string, () => Record<string, unknown>]>([
      ['another student’s suggestion', () => ({ resultId: otherResultId, ordinal: 0 })],
      ['an ordinal the result doesn’t have', () => ({ resultId, ordinal: 5 })],
      ['a result that doesn’t exist', () => ({ resultId: '999999999', ordinal: 0 })],
      ['a result id that isn’t a number', () => ({ resultId: 'abc', ordinal: 0 })],
      // Past what the insert's cast holds, which the DTO turns away rather
      // than leaving the database to fail with a 500.
      ['an ordinal past INTEGER', () => ({ resultId, ordinal: 2 ** 31 })],
      ['no target', () => ({})],
    ])('refuses a match to %s', async (_, target) => {
      const res = await decide({ version: 0, kind: 'match', ...target() });

      expect(res.status).toBe(400);
      expect(await rowsOf()).toEqual([]);
    });

    it.each(['exclude', 'undo'])('refuses %s with a target', async (kind) => {
      // Undo needs a decision to undo.
      expect((await matchFirst()).status).toBe(201);

      const res = await decide({ version: 1, kind, resultId, ordinal: 0 });

      expect(res.status).toBe(400);
      expect(await rowsOf()).toHaveLength(1);
    });

    it.each<[string, Record<string, unknown>]>([
      ['an unknown kind', { version: 0, kind: 'not-in-roster' }],
      ['a negative version', { version: -1, kind: 'exclude' }],
      ['a fractional version', { version: 0.5, kind: 'exclude' }],
      // seq is an INTEGER, and the next one would be version + 1.
      ['a version with no INTEGER after it', { version: 2 ** 31 - 1, kind: 'exclude' }],
      ['a version that isn’t a number', { version: '0', kind: 'exclude' }],
      ['no version', { kind: 'exclude' }],
    ])('refuses %s', async (_, body) => {
      const res = await decide(body);

      expect(res.status).toBe(400);
      expect(await rowsOf()).toEqual([]);
    });
  });

  describe('a decision', () => {
    it('saves a match, then an exclude, then undoes it', async () => {
      const matched = await decide({ version: 0, kind: 'match', resultId, ordinal: 1 });

      expect(matched.status).toBe(201);
      expect(matched.body).toEqual({
        version: 1,
        decision: {
          kind: 'match',
          resultId,
          ordinal: 1,
          decidedBy: expect.objectContaining({ id: userA.id }),
          decidedOn: expect.any(String),
        },
      });

      const excluded = await decide({ version: 1, kind: 'exclude' });

      expect(excluded.status).toBe(201);
      expect(excluded.body).toEqual({
        version: 2,
        decision: {
          kind: 'exclude',
          resultId: null,
          ordinal: null,
          decidedBy: expect.objectContaining({ id: userA.id }),
          decidedOn: expect.any(String),
        },
      });

      const undone = await decide({ version: 2, kind: 'undo' });

      expect(undone.status).toBe(201);
      expect(undone.body).toEqual({ version: 3, decision: null });

      expect(
        (await rowsOf()).map(({ seq, kind, resultId, ordinal, decidedById }) => ({
          seq,
          kind,
          resultId: resultId?.toString() ?? null,
          ordinal,
          decidedById,
        }))
      ).toEqual([
        { seq: 1, kind: 'match', resultId, ordinal: 1, decidedById: userA.id },
        { seq: 2, kind: 'exclude', resultId: null, ordinal: null, decidedById: userA.id },
        { seq: 3, kind: 'undo', resultId: null, ordinal: null, decidedById: userA.id },
      ]);
    });

    it('records who made each decision', async () => {
      const { cookies: second } = await authHelper.login(idpA, userB, tenantA);
      await matchFirst();

      const res = await decide({ version: 1, kind: 'exclude' }, { cookie: second });

      expect(res.body.decision.decidedBy).toEqual(expect.objectContaining({ id: userB.id }));
      expect((await rowsOf()).map((row) => row.decidedById)).toEqual([userA.id, userB.id]);
    });

    it('leaves other students’ decisions alone', async () => {
      await matchFirst();

      const res = await decide({ version: 0, kind: 'exclude' }, { correlationId: 'corr-2' });

      expect(res.status).toBe(201);
      expect(res.body.version).toBe(1);
      expect(await rowsOf('corr-1')).toHaveLength(1);
    });
  });

  describe('when a later run has searched again', () => {
    let laterResultId: string;
    beforeEach(async () => {
      const laterRun = await prisma.run.create({ data: { jobId: job.id, status: 'new' } });
      await reportMatchResults(laterRun.id, [
        {
          correlation_id: 'corr-1',
          candidate: { first_name: 'Ada' },
          matches: [{ student_unique_id: 'SUID-9', score: 0.95 }],
        },
      ]);
      laterResultId = await resultIdOf(job.id, 'corr-1', laterRun.id);
    });

    it('accepts a suggestion from the latest result', async () => {
      const res = await decide({ version: 0, kind: 'match', resultId: laterResultId, ordinal: 0 });

      expect(res.status).toBe(201);
    });

    it('refuses a suggestion from an earlier result as stale', async () => {
      const res = await matchFirst();

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, code: 'results_changed' });
      expect(await rowsOf()).toEqual([]);
    });
  });

  it('keeps a match made before a later run searched again', async () => {
    await matchFirst();
    const laterRun = await prisma.run.create({ data: { jobId: job.id, status: 'new' } });
    await reportMatchResults(laterRun.id, [
      { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
    ]);

    // New results don't change the version: the reviewer's view of the
    // decision is still current, so undo goes through.
    const res = await decide({ version: 1, kind: 'undo' });

    expect(res.status).toBe(201);
    expect(res.body.version).toBe(2);
  });

  describe('a write from a stale view', () => {
    const DECISION_CHANGED = { statusCode: 409, code: 'decision_changed' };

    it('is refused when another decision came first', async () => {
      await matchFirst();
      await decide({ version: 1, kind: 'exclude' });

      const res = await decide({ version: 1, kind: 'undo' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect(await rowsOf()).toHaveLength(2);
    });

    it('is refused at version 0 once the student has decisions', async () => {
      await matchFirst();

      const res = await decide({ version: 0, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect(await rowsOf()).toHaveLength(1);
    });

    it('is refused at a version ahead of the latest', async () => {
      await matchFirst();

      const res = await decide({ version: 5, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect(await rowsOf()).toHaveLength(1);
    });

    it('is refused when there is nothing to undo', async () => {
      const first = await decide({ version: 0, kind: 'undo' });
      await matchFirst();
      await decide({ version: 1, kind: 'undo' });
      const again = await decide({ version: 2, kind: 'undo' });

      expect([first.status, again.status]).toEqual([409, 409]);
      expect(again.body).toEqual(DECISION_CHANGED);
      expect((await rowsOf()).map((row) => row.kind)).toEqual(['match', 'undo']);
    });

    it('is refused after an undo, though the decision looks the same (ABA)', async () => {
      await matchFirst();
      await decide({ version: 1, kind: 'undo' });
      await decide({ version: 2, kind: 'match', resultId, ordinal: 0 });

      // A page loaded after the first match still holds version 1.
      const res = await decide({ version: 1, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(await rowsOf()).toHaveLength(3);
    });

    it('lets exactly one of two racing writes through', async () => {
      const results = await Promise.all([
        decide({ version: 0, kind: 'match', resultId, ordinal: 0 }),
        decide({ version: 0, kind: 'exclude' }),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await rowsOf()).toHaveLength(1);
    });
  });
});
