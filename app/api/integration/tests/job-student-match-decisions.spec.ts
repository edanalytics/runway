import request from 'supertest';
import { Logger } from '@nestjs/common';
import { IdMatchingMode } from '@prisma/client';
import { ExecutorAwsService } from 'api/src/earthbeam/executor/executor.aws.service';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigB2526 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantB, tenantDGlobal } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB } from '../fixtures/user-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { reportMatchResults } from '../helpers/report-match-results';
import { withoutPrivilege } from '../helpers/without-privilege';
import { pool } from '../helpers/db/client';
import { holdJobRow } from '../helpers/db/hold-job-row';
import { waitUntilBlockedBy } from '../helpers/db/wait-until-blocked-by';

describe('POST /jobs/:jobId/student-match-results/:correlationId/decisions', () => {
  const PARTNER_ADMIN = ['runway.test.user', 'runway.test.partneradmin'];
  const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];
  const DECISION_CHANGED = {
    statusCode: 409,
    code: 'decision_changed',
    message: 'This student’s decision has changed since the page loaded.',
  };
  /** The details a reviewer searched with, as the search route sent them to IDRS. */
  const SEARCH_DETAILS = {
    first_name: 'Ada',
    last_name: 'Lovelace',
    birth_date: '2010-12-10',
    school_ids: [101],
    student_ids: ['S-1'],
  };
  /**
   * A match to a student the reviewer found by searching: the answer, and the
   * search it rests on, with the student as the search route returned them.
   */
  const SEARCH_PICK = {
    studentUniqueId: 'SUID-FOUND',
    search: {
      searchDetails: SEARCH_DETAILS,
      rosterDetails: {
        first_name: 'Ada',
        middle_name: null,
        last_name: 'Lovelace',
        birth_date: '2010-12-10',
        student_ids: [{ id_type: 'State', id_value: 'S-1' }],
        school_years: [2025],
        future_field: 'kept',
      },
    },
  };

  let job: Awaited<ReturnType<typeof seedJob>>;
  /** corr-1's result, with suggestions at ordinals 0 and 1. */
  let resultId: string;
  /** corr-2's result, with one suggestion at ordinal 0. */
  let otherResultId: string;
  let cookies: string;

  /**
   * A job in this mode, with corr-1 and corr-2 reported by its full run.
   * Each suggestion has school years, as IDRS returns them, so a match can be
   * submitted.
   */
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
          { student_unique_id: 'SUID-1', score: 0.9, school_years: [2025] },
          { student_unique_id: 'SUID-2', score: 0.4, school_years: [2025] },
        ],
      },
      {
        correlation_id: 'corr-2',
        candidate: { first_name: 'Grace' },
        matches: [{ student_unique_id: 'SUID-3', score: 0.8, school_years: [2025] }],
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

  /** The student's first decision: a match to the result's first suggestion. */
  const matchFirst = (resultId: string) =>
    decide({ replacesVersion: null, kind: 'match', resultId, ordinal: 0 });

  beforeEach(async () => {
    job = await seedReportedJob('fuzzy');
    resultId = await resultIdOf(job.id, 'corr-1', job.runs[0].id);
    otherResultId = await resultIdOf(job.id, 'corr-2', job.runs[0].id);
    ({ cookies } = await authHelper.login(idpA, userA, tenantA));
  });

  describe('authentication and authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await decide({ replacesVersion: null, kind: 'exclude' }, { cookie: '' });

      expect(res.status).toBe(401);
    });

    it('rejects a user from another tenant', async () => {
      const { cookies: other } = await authHelper.login(idpA, userB, tenantB);

      const res = await decide({ replacesVersion: null, kind: 'exclude' }, { cookie: other });

      expect(res.status).toBe(403);
    });

    it('rejects a user without the match results update privilege', async () => {
      // Every role has it, so take it from the session.
      const res = await withoutPrivilege('job.match-results.update', () =>
        decide({ replacesVersion: null, kind: 'exclude' })
      );

      expect(res.status).toBe(403);
    });

    it('lets a support user decide across tenants', async () => {
      const tenantBJob = await seedReportedJob('fuzzy', true);
      const { cookies: support } = await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_USER);

      const res = await decide(
        { replacesVersion: null, kind: 'exclude' },
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
          { replacesVersion: null, kind: 'exclude' },
          { jobId: other.id, cookie: admin }
        );

        expect(res.status).toBe(403);
        expect(await rowsOf('corr-1', other.id)).toEqual([]);
      }
    );

    // The body is validated before the mode is checked, so a malformed body
    // is a 400 in any mode: the shape check lives in the DTO for this.
    it('refuses a malformed body as a 400 on a job in id_based mode', async () => {
      const other = await seedReportedJob('id_based');

      const res = await decide(
        { replacesVersion: null, kind: 'exclude', studentUniqueId: 'SUID-1' },
        { jobId: other.id }
      );

      expect(res.status).toBe(400);
    });
  });

  it('returns 404 for a student the job doesn’t have', async () => {
    const res = await decide(
      { replacesVersion: null, kind: 'exclude' },
      { correlationId: 'corr-unknown' }
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'not_found',
      message: 'This student isn’t in the job.',
    });
  });

  it.each([
    // PostgreSQL text can't hold one, so it must not reach a query.
    ['a NUL', 'corr%00'],
    ['129 characters', 'c'.repeat(129)],
  ])('refuses a correlation id with %s as a 400', async (_, correlationId) => {
    const res = await decide({ replacesVersion: null, kind: 'exclude' }, { correlationId });

    expect(res.status).toBe(400);
    // Nest's validation body, so it was the DTO that refused it.
    expect(res.body.message).toContainEqual(expect.stringMatching(/^correlationId /));
    expect(await prisma.studentMatchDecision.count({ where: { jobId: job.id } })).toBe(0);
  });

  describe('a bad request', () => {
    it.each<[string, () => Record<string, unknown>]>([
      ['another student’s result', () => ({ resultId: otherResultId, ordinal: 0 })],
      ['an ordinal its result doesn’t have', () => ({ resultId, ordinal: 5 })],
      ['no result id', () => ({ ordinal: 0 })],
    ])('refuses a suggestion pick with %s', async (_, target) => {
      const res = await decide({ replacesVersion: null, kind: 'match', ...target() });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        statusCode: 400,
        code: 'invalid_target',
        message: 'This student has no such suggestion.',
      });
      expect(await rowsOf()).toEqual([]);
    });

    // These name a real suggestion's result, so they get past the service's
    // check of the result id, and only the DTO stands between them and the
    // database: a fraction would be rounded to a neighbouring suggestion and
    // saved, and the others would be 500s.
    it.each<[string, Record<string, unknown>]>([
      ['a fractional ordinal', { ordinal: 0.5 }],
      ['an ordinal out of INTEGER range', { ordinal: 2 ** 31 }],
      ['no ordinal', {}],
    ])('refuses a match with %s', async (_, given) => {
      const res = await decide({ replacesVersion: null, kind: 'match', resultId, ...given });

      expect(res.status).toBe(400);
      // Nest's validation body, so it was the DTO that refused it.
      expect(res.body.message).toContainEqual(expect.stringMatching(/^ordinal /));
    });

    it.each<[string, Record<string, unknown>]>([
      ['an unknown kind', { replacesVersion: null, kind: 'not-in-roster' }],
      // No decision has version 0: null means none.
      ['replacesVersion 0', { replacesVersion: 0, kind: 'exclude' }],
      ['a fractional replacesVersion', { replacesVersion: 1.5, kind: 'exclude' }],
      ['a replacesVersion out of INTEGER range', { replacesVersion: 2 ** 31, kind: 'exclude' }],
      // It's required, not taken as null: a page that predates it can't
      // know whether the student is still undecided.
      ['a body with no replacesVersion', { kind: 'exclude' }],
    ])('refuses %s', async (_, body) => {
      const res = await decide(body);

      expect(res.status).toBe(400);
    });

    // Each would be a valid decision without the stray fields.
    it.each<[string, () => Record<string, unknown>, string]>([
      [
        'a match to a search with a suggestion',
        () => ({ kind: 'match', ...SEARCH_PICK, resultId, ordinal: 0 }),
        'resultId, ordinal must be absent from a match to a search',
      ],
      [
        'a match to a suggestion with a student unique id',
        () => ({ kind: 'match', resultId, ordinal: 0, studentUniqueId: 'SUID-1' }),
        'studentUniqueId must be absent from a match to a suggestion',
      ],
      [
        'an exclude with a search',
        () => ({ kind: 'exclude', search: SEARCH_PICK.search }),
        'search must be absent from an exclude',
      ],
      [
        'a clear with a student unique id',
        () => ({ kind: 'clear', studentUniqueId: 'SUID-1' }),
        'studentUniqueId must be absent from a clear',
      ],
    ])('refuses %s', async (_, body, refusal) => {
      const res = await decide({ replacesVersion: null, ...body() });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ statusCode: 400, message: [refusal], error: 'Bad Request' });
    });
  });

  describe('a decision', () => {
    it('saves a match, then an exclude, then clears it', async () => {
      const matched = await decide({ replacesVersion: null, kind: 'match', resultId, ordinal: 1 });

      expect(matched.status).toBe(201);
      expect(matched.body).toEqual({
        decision: {
          version: 1,
          kind: 'match',
          // The suggestion's student, at ordinal 1.
          studentUniqueId: 'SUID-2',
          resultId,
          ordinal: 1,
          search: null,
          decidedBy: expect.objectContaining({ id: userA.id }),
          decidedOn: expect.any(String),
        },
      });

      const excluded = await decide({ replacesVersion: 1, kind: 'exclude' });

      expect(excluded.status).toBe(201);
      expect(excluded.body).toEqual({
        decision: {
          version: 2,
          kind: 'exclude',
          studentUniqueId: null,
          resultId: null,
          ordinal: null,
          search: null,
          decidedBy: expect.objectContaining({ id: userA.id }),
          decidedOn: expect.any(String),
        },
      });

      const cleared = await decide({ replacesVersion: 2, kind: 'clear' });

      expect(cleared.status).toBe(201);
      expect(cleared.body).toEqual({ decision: null });

      expect(
        (await rowsOf()).map(({ seq, kind, studentUniqueId, resultId, ordinal, decidedById }) => ({
          seq,
          kind,
          studentUniqueId,
          resultId: resultId?.toString() ?? null,
          ordinal,
          decidedById,
        }))
      ).toEqual([
        {
          seq: 1,
          kind: 'match',
          studentUniqueId: 'SUID-2',
          resultId,
          ordinal: 1,
          decidedById: userA.id,
        },
        {
          seq: 2,
          kind: 'exclude',
          studentUniqueId: null,
          resultId: null,
          ordinal: null,
          decidedById: userA.id,
        },
        {
          seq: 3,
          kind: 'clear',
          studentUniqueId: null,
          resultId: null,
          ordinal: null,
          decidedById: userA.id,
        },
      ]);
    });

    it('accepts an exclude that sends the other fields as null', async () => {
      const res = await decide({
        replacesVersion: null,
        kind: 'exclude',
        resultId: null,
        ordinal: null,
        studentUniqueId: null,
        search: null,
      });

      expect(res.status).toBe(201);
    });

    it('records who made each decision', async () => {
      const { cookies: second } = await authHelper.login(idpA, userB, tenantA);
      await matchFirst(resultId);

      const res = await decide({ replacesVersion: 1, kind: 'exclude' }, { cookie: second });

      expect(res.body.decision.decidedBy).toEqual(expect.objectContaining({ id: userB.id }));
      expect((await rowsOf()).map((row) => row.decidedById)).toEqual([userA.id, userB.id]);
    });

    it.each<[string, () => Promise<{ jobId?: number; correlationId?: string }>]>([
      ['another student in the job', async () => ({ correlationId: 'corr-2' })],
      [
        'the same student in the file reprocessed as a new job',
        async () => ({ jobId: (await seedReportedJob('fuzzy')).id }),
      ],
    ])('checks the version against the student’s own decisions, not %s', async (_, locateOther) => {
      // A decision at version 1 for corr-1 in this job. The other student has
      // none, so a check that looked beyond their own decisions would find this.
      await matchFirst(resultId);
      const otherStudent = await locateOther();

      const withCorr1sVersion = await decide({ replacesVersion: 1, kind: 'exclude' }, otherStudent);
      const withItsOwn = await decide({ replacesVersion: null, kind: 'exclude' }, otherStudent);

      expect(withCorr1sVersion.body).toEqual(DECISION_CHANGED);
      expect(withItsOwn.status).toBe(201);
      expect(withItsOwn.body.decision.version).toBe(1);
    });
  });

  describe('when a later run has searched again', () => {
    let laterResultId: string;
    beforeEach(async () => {
      const laterRun = await prisma.run.create({
        data: { jobId: job.id, kind: 'full', status: 'new' },
      });
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
        replacesVersion: null,
        kind: 'match',
        resultId: laterResultId,
        ordinal: 0,
      });

      expect(res.status).toBe(201);
    });

    // The page predates the latest result, so refetching is the fix, whatever
    // it picked from the earlier one: even an ordinal that result doesn't have.
    it.each([0, 7])(
      'refuses a pick from an earlier result as stale, at ordinal %i',
      async (ordinal) => {
        const res = await decide({ replacesVersion: null, kind: 'match', resultId, ordinal });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          statusCode: 409,
          code: 'results_changed',
          message: 'This student has newer suggestions than the page shows.',
        });
        expect(await rowsOf()).toEqual([]);
      }
    );
  });

  it('accepts a write replacing a match made before a later run searched again', async () => {
    await matchFirst(resultId);
    const laterRun = await prisma.run.create({
      data: { jobId: job.id, kind: 'full', status: 'new' },
    });
    await reportMatchResults(laterRun.id, [
      { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
    ]);

    // New results don't change the decision's version: the reviewer's view of
    // it is still current, so clear goes through.
    const res = await decide({ replacesVersion: 1, kind: 'clear' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ decision: null });
  });

  describe('the version check', () => {
    // A page loaded after the first match holds version 1. Since then the
    // match was cleared and made again, so the decision looks as it did (ABA).
    it('refuses a write whose decision was changed and changed back', async () => {
      await matchFirst(resultId);
      await decide({ replacesVersion: 1, kind: 'clear' });
      await decide({ replacesVersion: null, kind: 'match', resultId, ordinal: 0 });

      const res = await decide({ replacesVersion: 1, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect((await rowsOf()).map((row) => row.kind)).toEqual(['match', 'clear', 'match']);
    });

    // Versions only come from the API's responses, so one past the latest names
    // a decision that doesn't exist. The next seq is the one an insert would write.
    it('refuses a write at a version ahead of the latest', async () => {
      await matchFirst(resultId);

      const res = await decide({ replacesVersion: 2, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect(await rowsOf()).toHaveLength(1);
    });

    // A page that saw no decision is still current once a decision is made
    // and cleared: the student is undecided, just as it showed.
    it('accepts a write that saw no decision, after one was made and cleared', async () => {
      await matchFirst(resultId);
      await decide({ replacesVersion: 1, kind: 'clear' });

      const res = await decide({ replacesVersion: null, kind: 'exclude' });

      expect(res.status).toBe(201);
      expect(res.body.decision.version).toBe(3);
    });

    it('refuses a write that saw no decision, once the student has one', async () => {
      await matchFirst(resultId);

      const res = await decide({ replacesVersion: null, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect(await rowsOf()).toHaveLength(1);
    });

    // No decision is either no rows or a clear on top, so both are tried.
    it('refuses a clear when there is nothing to clear', async () => {
      const never = await decide({ replacesVersion: null, kind: 'clear' });
      await matchFirst(resultId);
      await decide({ replacesVersion: 1, kind: 'clear' });
      const again = await decide({ replacesVersion: null, kind: 'clear' });
      // The clear's own seq isn't a decision's version, so it's no way round.
      const atClear = await decide({ replacesVersion: 2, kind: 'clear' });

      expect([never.body, again.body, atClear.body]).toEqual(Array(3).fill(DECISION_CHANGED));
      expect((await rowsOf()).map((row) => row.kind)).toEqual(['match', 'clear']);
    });

    // Two reviewers save the same undecided student at once. The other
    // reviewer's write is held uncommitted until this request is waiting on
    // it, so the race happens every time. A check before the insert can't see
    // an uncommitted row, so check-then-insert would collide on the primary
    // key with a 500.
    it('refuses the write that loses a race', async () => {
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

        // then() sends the request now, rather than when it's awaited.
        const pending = matchFirst(resultId).then((res) => res);
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

  // Every send of a student delivers the same decision row, so once any of
  // their rows is in a send run, no new decision is accepted.
  describe('a submitted student', () => {
    const ALREADY_SUBMITTED = {
      statusCode: 409,
      code: 'already_submitted',
      message: 'This student’s match has been submitted.',
    };
    let executorStart: jest.SpyInstance;

    /** Submits corr-1's match at this version. */
    const submit = (version: number) =>
      request(app.getHttpServer())
        .post(`/jobs/${job.id}/student-match-results/submit`)
        .set('Cookie', [cookies])
        .send({ students: [{ correlationId: 'corr-1', version }] });

    beforeEach(async () => {
      executorStart = jest
        .spyOn(ExecutorAwsService.prototype, 'start')
        .mockResolvedValue({ ecsTaskArn: null, taskSize: null });
      // Submitting needs the job's full run to have succeeded.
      await prisma.run.update({ where: { id: job.runs[0].id }, data: { status: 'success' } });
      expect((await matchFirst(resultId)).status).toBe(201);
    });

    afterEach(() => {
      executorStart.mockRestore();
    });

    it.each<[string, () => Record<string, unknown>]>([
      ['another match', () => ({ kind: 'match', resultId, ordinal: 1 })],
      ['an exclude', () => ({ kind: 'exclude' })],
      ['a clear', () => ({ kind: 'clear' })],
    ])('refuses %s, writing nothing', async (_, body) => {
      expect((await submit(1)).status).toBe(201);

      const res = await decide({ replacesVersion: 1, ...body() });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(ALREADY_SUBMITTED);
      expect((await rowsOf()).map(({ seq, kind }) => [seq, kind])).toEqual([[1, 'match']]);
    });

    // Their match can only be submitted again, with the same decision row.
    it('refuses a new decision after their send run fails, writing nothing', async () => {
      executorStart.mockRejectedValueOnce(new Error('ECS is unavailable'));
      expect((await submit(1)).body.launched).toBe(false);

      const res = await decide({ replacesVersion: 1, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(ALREADY_SUBMITTED);
      expect((await rowsOf()).map(({ seq, kind }) => [seq, kind])).toEqual([[1, 'match']]);
    });

    // A reviewer decides a student while another submits them. The job row is
    // held from another connection until both requests are queued behind it,
    // in a chosen order, so each order happens every time. Whichever goes
    // first wins, and the other is refused.
    describe('racing a submit', () => {
      /** Sends the requests in order, each queued behind a held job-row lock, then releases it. */
      const raceInOrder = async <T extends unknown[]>(requests: {
        [K in keyof T]: () => Promise<T[K]>;
      }) => {
        const holder = await holdJobRow(job.id);
        try {
          const pending: Promise<unknown>[] = [];
          for (const send of requests) {
            pending.push(send());
            await waitUntilBlockedBy(holder.pid, pending.length);
          }
          await holder.client.query('ROLLBACK');
          return (await Promise.all(pending)) as T;
        } finally {
          await holder.release();
        }
      };

      // then() sends each request when called, rather than when it's awaited.
      const excludeAfterTheMatch = () =>
        decide({ replacesVersion: 1, kind: 'exclude' }).then((res) => res);
      const submitTheMatch = () => submit(1).then((res) => res);

      it('refuses the decision once the submit has gone first', async () => {
        const [submitted, decided] = await raceInOrder([submitTheMatch, excludeAfterTheMatch]);

        expect(submitted.status).toBe(201);
        expect(decided.status).toBe(409);
        expect(decided.body).toEqual(ALREADY_SUBMITTED);
        expect((await rowsOf()).map(({ seq, kind }) => [seq, kind])).toEqual([[1, 'match']]);
      });

      it('refuses the submit once the decision has gone first', async () => {
        const [decided, submitted] = await raceInOrder([excludeAfterTheMatch, submitTheMatch]);

        expect(decided.status).toBe(201);
        expect(submitted.status).toBe(409);
        expect(submitted.body).toEqual({
          statusCode: 409,
          code: 'decision_changed',
          message: 'A student’s decision has changed since the page loaded.',
          indices: [0],
        });
        expect(await prisma.sendRunDecision.count({ where: { jobId: job.id } })).toBe(0);
      });
    });
  });

  describe('a match to a search', () => {
    const matchSearch = (replacesVersion: number | null, pick: object = SEARCH_PICK) =>
      decide({ replacesVersion, kind: 'match', ...pick });

    it('saves the student found and the search that found them', async () => {
      // A key IDRS doesn't take is dropped, as the search route drops it.
      const res = await matchSearch(null, {
        ...SEARCH_PICK,
        search: {
          ...SEARCH_PICK.search,
          searchDetails: { ...SEARCH_DETAILS, middle_name: 'Augusta' },
        },
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        decision: {
          version: 1,
          kind: 'match',
          studentUniqueId: 'SUID-FOUND',
          resultId: null,
          ordinal: null,
          search: SEARCH_PICK.search,
          decidedBy: expect.objectContaining({ id: userA.id }),
          decidedOn: expect.any(String),
        },
      });
      // The whole row, so nothing else about the search is stored.
      expect(await rowsOf()).toEqual([
        {
          jobId: job.id,
          correlationId: 'corr-1',
          seq: 1,
          kind: 'match',
          studentUniqueId: 'SUID-FOUND',
          resultId: null,
          ordinal: null,
          searchDetails: SEARCH_DETAILS,
          rosterDetails: SEARCH_PICK.search.rosterDetails,
          decidedById: userA.id,
          decidedOn: expect.any(Date),
        },
      ]);
    });

    it('replaces a match to a suggestion', async () => {
      await matchFirst(resultId);

      const res = await matchSearch(1);

      expect(res.status).toBe(201);
      expect(res.body.decision.version).toBe(2);
      expect(
        (await rowsOf()).map((row) => [row.resultId?.toString() ?? null, row.studentUniqueId])
      ).toEqual([
        [resultId, 'SUID-1'],
        [null, 'SUID-FOUND'],
      ]);
    });

    // The responses show a suggestion pick's search as null, so a page may
    // send it back that way.
    it('accepts a suggestion pick that sends search as null', async () => {
      const res = await decide({
        replacesVersion: null,
        kind: 'match',
        resultId,
        ordinal: 0,
        search: null,
      });

      expect(res.status).toBe(201);
      expect(res.body.decision).toMatchObject({ resultId, ordinal: 0, search: null });
    });

    it.each<[string, object, RegExp]>([
      ['no student unique id', { studentUniqueId: undefined }, /^studentUniqueId /],
      ['a student unique id that isn’t a string', { studentUniqueId: 123 }, /^studentUniqueId /],
      ['an empty student unique id', { studentUniqueId: '' }, /^studentUniqueId /],
      // Nested validation alone checks each of an array's elements, and passes an empty one.
      ['an array for its search', { search: [] }, /^search /],
      [
        'roster details that aren’t an object',
        { search: { ...SEARCH_PICK.search, rosterDetails: ['Ada'] } },
        /^search\.rosterDetails /,
      ],
      [
        'no search details',
        { search: { rosterDetails: SEARCH_PICK.search.rosterDetails } },
        /^search\.searchDetails /,
      ],
      [
        'search details the search route would refuse',
        {
          search: {
            ...SEARCH_PICK.search,
            searchDetails: { ...SEARCH_DETAILS, birth_date: '2010-02-30' },
          },
        },
        /^search\.searchDetails\.birth_date /,
      ],
    ])('refuses a match to a search with %s', async (_, given, refusal) => {
      const res = await matchSearch(null, { ...SEARCH_PICK, ...given });

      expect(res.status).toBe(400);
      // Nest's validation body, so it was the DTO that refused it.
      expect(res.body.message).toContainEqual(expect.stringMatching(refusal));
    });
  });

  // The route can't send the database these rows: it reads a suggestion
  // pick's answer from the suggestion, and validation shapes the basis. So
  // they're written directly, to pin the constraints the route relies on.
  describe('the table', () => {
    type Row = {
      kind: string;
      studentUniqueId?: string;
      resultId?: string;
      ordinal?: number;
      /** Which of a search's two columns to fill. */
      search?: 'both' | 'details only' | 'roster only';
    };
    const insert = ({ kind, studentUniqueId, resultId, ordinal, search }: Row) =>
      pool().query(
        `INSERT INTO public.student_match_decision
           (job_id, correlation_id, seq, kind, decided_by_id,
            student_unique_id, result_id, ordinal, search_details, roster_details)
         VALUES ($1, 'corr-1', 1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          job.id,
          kind,
          userA.id,
          studentUniqueId ?? null,
          resultId ?? null,
          ordinal ?? null,
          search && search !== 'roster only' ? JSON.stringify(SEARCH_DETAILS) : null,
          search && search !== 'details only'
            ? JSON.stringify(SEARCH_PICK.search.rosterDetails)
            : null,
        ]
      );

    it('refuses a suggestion match whose student isn’t the suggestion’s', async () => {
      // Ordinal 0 suggests SUID-1.
      await expect(
        insert({ kind: 'match', studentUniqueId: 'SUID-2', resultId, ordinal: 0 })
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'student_match_decision_suggestion_fkey',
      });
    });

    it.each<[string, () => Row]>([
      ['a match with no student unique id', () => ({ kind: 'match', resultId, ordinal: 0 })],
      [
        'a match with no suggestion or search',
        () => ({ kind: 'match', studentUniqueId: 'SUID-1' }),
      ],
      [
        'a match with both a suggestion and a search',
        () => ({ kind: 'match', studentUniqueId: 'SUID-1', resultId, ordinal: 0, search: 'both' }),
      ],
      // The read builds a search from both columns, so neither comes alone.
      [
        'a match to a search with no roster details',
        () => ({ kind: 'match', studentUniqueId: 'SUID-1', search: 'details only' }),
      ],
      [
        'a match to a search with no search details',
        () => ({ kind: 'match', studentUniqueId: 'SUID-1', search: 'roster only' }),
      ],
      [
        'an exclude with a student unique id',
        () => ({ kind: 'exclude', studentUniqueId: 'SUID-1' }),
      ],
    ])('refuses %s', async (_, row) => {
      await expect(insert(row())).rejects.toMatchObject({
        code: '23514',
        constraint: 'student_match_decision_check',
      });
    });
  });

  // Validation lets a NUL through, but PostgreSQL's jsonb can't store one.
  it('answers a database failure with a 500, logging only codes', async () => {
    const logs: string[] = [];
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      logs.push(String(message));
    });
    try {
      const res = await decide({
        replacesVersion: null,
        kind: 'match',
        ...SEARCH_PICK,
        search: { ...SEARCH_PICK.search, rosterDetails: { first_name: 'Ada\u0000' } },
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        statusCode: 500,
        message: 'Failed to save the decision',
        error: 'Internal Server Error',
      });
      expect(logs).toEqual([
        `student match decision: jobId=${job.id} outcome=FAILED cause=PrismaClientKnownRequestError sqlstate=22P05`,
      ]);
    } finally {
      errorLog.mockRestore();
    }
  });
});
