import request from 'supertest';
import { Logger } from '@nestjs/common';
import { IdMatchingMode } from '@prisma/client';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigB2526 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantB, tenantDGlobal } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB } from '../fixtures/user-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { GetSessionDataDto, PrivilegeKey } from '@edanalytics/models';
import { reportMatchResults } from '../helpers/report-match-results';
import { pool } from '../helpers/db/client';
import { JobsService } from 'api/src/jobs/jobs.service';

describe('POST /jobs/:jobId/student-match-results/:correlationId/decisions', () => {
  const PARTNER_ADMIN = ['runway.test.user', 'runway.test.partneradmin'];
  const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];

  let job: Awaited<ReturnType<typeof seedJob>>;
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

  const matchFirst = () => decide({ version: null, kind: 'match', resultId, ordinal: 0 });

  beforeEach(async () => {
    job = await seedReportedJob('fuzzy');
    resultId = await resultIdOf(job.id, 'corr-1', job.runs[0].id);
    otherResultId = await resultIdOf(job.id, 'corr-2', job.runs[0].id);
    ({ cookies } = await authHelper.login(idpA, userA, tenantA));
  });

  describe('authentication and authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await decide({ version: null, kind: 'exclude' }, { cookie: '' });

      expect(res.status).toBe(401);
      expect(await rowsOf()).toEqual([]);
    });

    it('rejects a user from another tenant', async () => {
      const { cookies: other } = await authHelper.login(idpA, userB, tenantB);

      const res = await decide({ version: null, kind: 'exclude' }, { cookie: other });

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
        const res = await decide({ version: null, kind: 'exclude' });

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
        { version: null, kind: 'exclude' },
        { jobId: tenantBJob.id, cookie: support }
      );

      expect(res.status).toBe(201);
      expect(await rowsOf('corr-1', tenantBJob.id)).toHaveLength(1);
    });
  });

  describe('by matching mode', () => {
    it.each<IdMatchingMode>(['id_based_fuzzy_background', 'id_based'])(
      'refuses a decision on a job in %s mode, even from a partner admin',
      async (mode) => {
        const other = await seedReportedJob(mode);
        const { cookies: admin } = await authHelper.login(idpA, userA, tenantA, PARTNER_ADMIN);

        const res = await decide(
          { version: null, kind: 'exclude' },
          { jobId: other.id, cookie: admin }
        );

        expect(res.status).toBe(403);
        expect(await rowsOf('corr-1', other.id)).toEqual([]);
      }
    );
  });

  it('returns 404 for a student the job doesn’t have', async () => {
    const res = await decide({ version: null, kind: 'exclude' }, { correlationId: 'corr-unknown' });

    expect(res.status).toBe(404);
  });

  describe('a bad request', () => {
    it.each<[string, () => Record<string, unknown>]>([
      ['another student’s suggestion', () => ({ resultId: otherResultId, ordinal: 0 })],
      ['an ordinal the result doesn’t have', () => ({ resultId, ordinal: 5 })],
      ['no result id', () => ({ ordinal: 0 })],
      ['a numeric result id', () => ({ resultId: Number(resultId), ordinal: 0 })],
      // The rest get past the service's check of the result id, so only the
      // DTO stands between them and the database: a fraction would be rounded
      // to a neighbouring suggestion and saved, and the others would be 500s.
      ['a fractional ordinal', () => ({ resultId, ordinal: 0.5 })],
      ['an ordinal given as a string', () => ({ resultId, ordinal: '0' })],
      ['an ordinal past INTEGER', () => ({ resultId, ordinal: 2 ** 31 })],
      ['no ordinal', () => ({ resultId })],
    ])('refuses a match to %s', async (_, target) => {
      const res = await decide({ version: null, kind: 'match', ...target() });

      expect(res.status).toBe(400);
      expect(await rowsOf()).toEqual([]);
    });

    it.each<[string, Record<string, unknown>]>([
      ['an unknown kind', { version: null, kind: 'not-in-roster' }],
      // No decision has version 0: null means none.
      ['a version of 0', { version: 0, kind: 'exclude' }],
      ['a fractional version', { version: 1.5, kind: 'exclude' }],
      ['a version past INTEGER', { version: 2 ** 31, kind: 'exclude' }],
      // Version is required, not taken as null: a page that predates it can't
      // know whether the student is still undecided.
      ['no version', { kind: 'exclude' }],
    ])('refuses %s', async (_, body) => {
      const res = await decide(body);

      expect(res.status).toBe(400);
      expect(await rowsOf()).toEqual([]);
    });
  });

  describe('a decision', () => {
    it('saves a match, then an exclude, then clears it', async () => {
      const matched = await decide({ version: null, kind: 'match', resultId, ordinal: 1 });

      expect(matched.status).toBe(201);
      expect(matched.body).toEqual({
        decision: {
          version: 1,
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
        decision: {
          version: 2,
          kind: 'exclude',
          resultId: null,
          ordinal: null,
          decidedBy: expect.objectContaining({ id: userA.id }),
          decidedOn: expect.any(String),
        },
      });

      const cleared = await decide({ version: 2, kind: 'clear' });

      expect(cleared.status).toBe(201);
      expect(cleared.body).toEqual({ decision: null });

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
        { seq: 3, kind: 'clear', resultId: null, ordinal: null, decidedById: userA.id },
      ]);
    });

    it('ignores a target sent with an exclude or a clear', async () => {
      const target = { resultId, ordinal: 0 };

      const excluded = await decide({ version: null, kind: 'exclude', ...target });
      const cleared = await decide({ version: 1, kind: 'clear', ...target });

      expect(excluded.status).toBe(201);
      expect(excluded.body.decision).toMatchObject({
        kind: 'exclude',
        resultId: null,
        ordinal: null,
      });
      expect(cleared.status).toBe(201);
      expect((await rowsOf()).map(({ resultId, ordinal }) => ({ resultId, ordinal }))).toEqual([
        { resultId: null, ordinal: null },
        { resultId: null, ordinal: null },
      ]);
    });

    it('records who made each decision', async () => {
      const { cookies: second } = await authHelper.login(idpA, userB, tenantA);
      await matchFirst();

      const res = await decide({ version: 1, kind: 'exclude' }, { cookie: second });

      expect(res.body.decision.decidedBy).toEqual(expect.objectContaining({ id: userB.id }));
      expect((await rowsOf()).map((row) => row.decidedById)).toEqual([userA.id, userB.id]);
    });

    it('versions each student’s decisions separately', async () => {
      await matchFirst();

      // corr-1's decision is at version 1; corr-2 has none yet.
      const borrowed = await decide({ version: 1, kind: 'exclude' }, { correlationId: 'corr-2' });
      const own = await decide({ version: null, kind: 'exclude' }, { correlationId: 'corr-2' });

      expect(borrowed.status).toBe(409);
      expect(own.status).toBe(201);
      expect(own.body.decision.version).toBe(1);
      expect((await rowsOf('corr-1')).map((row) => row.kind)).toEqual(['match']);
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
      const res = await decide({
        version: null,
        kind: 'match',
        resultId: laterResultId,
        ordinal: 0,
      });

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

    // New results don't change the decision's version: the reviewer's view of
    // it is still current, so clear goes through.
    const res = await decide({ version: 1, kind: 'clear' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ decision: null });
  });

  describe('a write from a stale view', () => {
    const DECISION_CHANGED = { statusCode: 409, code: 'decision_changed' };

    // A page loaded after the first match holds version 1. Since then the
    // match was cleared and made again, so the decision looks as it did (ABA).
    it('is refused when the decision was changed and changed back', async () => {
      await matchFirst();
      await decide({ version: 1, kind: 'clear' });
      await decide({ version: null, kind: 'match', resultId, ordinal: 0 });

      const res = await decide({ version: 1, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect((await rowsOf()).map((row) => row.kind)).toEqual(['match', 'clear', 'match']);
    });

    // A page that saw no decision is still current once a decision is made
    // and cleared: the student is undecided, just as it showed.
    it('is accepted with no version after a decision was made and cleared', async () => {
      await matchFirst();
      await decide({ version: 1, kind: 'clear' });

      const res = await decide({ version: null, kind: 'exclude' });

      expect(res.status).toBe(201);
      expect(res.body.decision.version).toBe(3);
    });

    it('is refused with no version once the student has a decision', async () => {
      await matchFirst();

      const res = await decide({ version: null, kind: 'exclude' });

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

    it('is refused when there is nothing to clear', async () => {
      const first = await decide({ version: null, kind: 'clear' });
      await matchFirst();
      await decide({ version: 1, kind: 'clear' });
      const again = await decide({ version: null, kind: 'clear' });
      // The clear's own seq isn't a decision's version, so it's no way round.
      const atClear = await decide({ version: 2, kind: 'clear' });

      expect([first.status, again.status, atClear.status]).toEqual([409, 409, 409]);
      expect(again.body).toEqual(DECISION_CHANGED);
      expect((await rowsOf()).map((row) => row.kind)).toEqual(['match', 'clear']);
    });

    // Two reviewers save the same undecided student at once. The other
    // reviewer's write is held uncommitted until this request is waiting on
    // it, so the race happens every time. A check before the insert can't see
    // an uncommitted row, so check-then-insert would collide on the primary
    // key with a 500.
    it('is refused when it loses a race', async () => {
      const other = await pool().connect();
      try {
        await other.query('BEGIN');
        await other.query(
          `INSERT INTO public.student_match_decision
             (job_id, correlation_id, seq, kind, decided_by_id)
           VALUES ($1, 'corr-1', 1, 'exclude', $2)`,
          [job.id, userB.id]
        );
        const { rows } = await other.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');

        const pending = matchFirst().then((res) => res);
        await waitUntilBlockedBy(rows[0].pid);
        await other.query('COMMIT');
        const res = await pending;

        expect(res.status).toBe(409);
        expect(res.body).toEqual(DECISION_CHANGED);
        expect((await rowsOf()).map((row) => [row.kind, row.decidedById])).toEqual([
          ['exclude', userB.id],
        ]);
      } finally {
        // Releases the lock if the test failed before the commit.
        await other.query('ROLLBACK');
        other.release();
      }
    });
  });

  // The DTO stops every input known to fail in the database, so this one gets
  // past it in the service: a match with no ordinal, which the table's CHECK
  // refuses. The real error quotes the failing row.
  it('answers an unexpected database failure with a 500, logging only codes', async () => {
    const service = app.get(JobsService);
    const decideStudentMatch = service.decideStudentMatch.bind(service);
    let error: unknown;
    const withTarget = jest
      .spyOn(service, 'decideStudentMatch')
      .mockImplementation(async (input, prisma) => {
        try {
          const decision = { ...input.decision, kind: 'match' as const, resultId };
          return await decideStudentMatch({ ...input, decision }, prisma);
        } catch (err) {
          error = err;
          throw err;
        }
      });
    const logs: string[] = [];
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      logs.push(String(message));
    });
    try {
      const res = await decide({ version: null, kind: 'exclude' });

      expect(error).toMatchObject({ message: expect.stringContaining('corr-1') });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        statusCode: 500,
        message: 'Failed to save the decision',
        error: 'Internal Server Error',
      });
      expect(logs).toEqual([
        `student match decision: jobId=${job.id} outcome=FAILED cause=PrismaClientKnownRequestError sqlstate=23514`,
      ]);
    } finally {
      withTarget.mockRestore();
      errorLog.mockRestore();
    }
  });
});

/** Waits until a session is blocked waiting on the given database backend. */
const waitUntilBlockedBy = async (pid: number) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rowCount } = await pool().query(
      'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [pid]
    );
    if (rowCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Nothing waited on backend ${pid}`);
};
