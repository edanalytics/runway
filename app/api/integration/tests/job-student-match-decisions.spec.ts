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
import { reportMatchResults } from '../helpers/report-match-results';
import { withoutPrivilege } from '../helpers/without-privilege';
import { pool } from '../helpers/db/client';

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

  /** Each of the student's decisions' answer and basis, as stored, in order. */
  const answersAndBasesOf = async () =>
    (await rowsOf()).map(
      ({ studentUniqueId, resultId, ordinal, searchDetails, rosterDetails }) => ({
        studentUniqueId,
        resultId: resultId?.toString() ?? null,
        ordinal,
        searchDetails,
        rosterDetails,
      })
    );

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

  describe('a bad request', () => {
    it.each<[string, () => Record<string, unknown>]>([
      ['another student’s suggestion', () => ({ resultId: otherResultId, ordinal: 0 })],
      ['an ordinal the result doesn’t have', () => ({ resultId, ordinal: 5 })],
      ['no result id', () => ({ ordinal: 0 })],
    ])('refuses a match to %s as no such suggestion', async (_, target) => {
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
      ['an ordinal past INTEGER', { ordinal: 2 ** 31 }],
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
      ['a replaced version of 0', { replacesVersion: 0, kind: 'exclude' }],
      ['a fractional replaced version', { replacesVersion: 1.5, kind: 'exclude' }],
      ['a replaced version past INTEGER', { replacesVersion: 2 ** 31, kind: 'exclude' }],
      // It's required, not taken as null: a page that predates it can't
      // know whether the student is still undecided.
      ['no replaced version', { kind: 'exclude' }],
    ])('refuses %s', async (_, body) => {
      const res = await decide(body);

      expect(res.status).toBe(400);
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

    // The answer sent would fail validation, so this also shows it isn't validated.
    it('takes a suggestion pick’s student from the suggestion, ignoring one sent', async () => {
      const res = await decide({
        replacesVersion: null,
        kind: 'match',
        resultId,
        ordinal: 0,
        studentUniqueId: 123,
      });

      expect(res.status).toBe(201);
      expect(await answersAndBasesOf()).toEqual([
        {
          studentUniqueId: 'SUID-1',
          resultId,
          ordinal: 0,
          searchDetails: null,
          rosterDetails: null,
        },
      ]);
    });

    // Each would fail validation, so this also shows none is validated.
    it('ignores a student, suggestion or search sent with an exclude or a clear', async () => {
      const ignored = {
        resultId,
        ordinal: 0.5,
        studentUniqueId: 123,
        search: { searchDetails: 'Ada', rosterDetails: ['Ada'] },
      };

      const excluded = await decide({ replacesVersion: null, kind: 'exclude', ...ignored });
      const cleared = await decide({ replacesVersion: 1, kind: 'clear', ...ignored });

      expect([excluded.status, cleared.status]).toEqual([201, 201]);
      const none = {
        studentUniqueId: null,
        resultId: null,
        ordinal: null,
        searchDetails: null,
        rosterDetails: null,
      };
      expect(await answersAndBasesOf()).toEqual([none, none]);
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
    const laterRun = await prisma.run.create({ data: { jobId: job.id, status: 'new' } });
    await reportMatchResults(laterRun.id, [
      { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
    ]);

    // New results don't change the decision's version: the reviewer's view of
    // it is still current, so clear goes through.
    const res = await decide({ replacesVersion: 1, kind: 'clear' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ decision: null });
  });

  describe('a write from a stale view', () => {
    // A page loaded after the first match holds version 1. Since then the
    // match was cleared and made again, so the decision looks as it did (ABA).
    it('is refused when the decision was changed and changed back', async () => {
      await matchFirst(resultId);
      await decide({ replacesVersion: 1, kind: 'clear' });
      await decide({ replacesVersion: null, kind: 'match', resultId, ordinal: 0 });

      const res = await decide({ replacesVersion: 1, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect((await rowsOf()).map((row) => row.kind)).toEqual(['match', 'clear', 'match']);
    });

    // A page that saw no decision is still current once a decision is made
    // and cleared: the student is undecided, just as it showed.
    it('is accepted replacing nothing after a decision was made and cleared', async () => {
      await matchFirst(resultId);
      await decide({ replacesVersion: 1, kind: 'clear' });

      const res = await decide({ replacesVersion: null, kind: 'exclude' });

      expect(res.status).toBe(201);
      expect(res.body.decision.version).toBe(3);
    });

    it('is refused replacing nothing once the student has a decision', async () => {
      await matchFirst(resultId);

      const res = await decide({ replacesVersion: null, kind: 'exclude' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect(await rowsOf()).toHaveLength(1);
    });

    it('is refused when there is nothing to clear', async () => {
      await matchFirst(resultId);
      await decide({ replacesVersion: 1, kind: 'clear' });
      const again = await decide({ replacesVersion: null, kind: 'clear' });
      // The clear's own seq isn't a decision's version, so it's no way round.
      const atClear = await decide({ replacesVersion: 2, kind: 'clear' });

      expect([again.body, atClear.body]).toEqual([DECISION_CHANGED, DECISION_CHANGED]);
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

    // Neither the suggestion checks nor validation run on it: the student
    // doesn't have this result, and validation would refuse the ordinal.
    it('ignores a suggestion sent beside the search', async () => {
      const res = await decide({
        replacesVersion: null,
        kind: 'match',
        ...SEARCH_PICK,
        resultId: otherResultId,
        ordinal: 0.5,
      });

      expect(res.status).toBe(201);
      expect(await answersAndBasesOf()).toEqual([
        { studentUniqueId: 'SUID-FOUND', resultId: null, ordinal: null, ...SEARCH_PICK.search },
      ]);
    });

    // The responses show a suggestion pick's search as null, so a page may
    // send it back that way.
    it('takes a null search beside a suggestion as a suggestion pick', async () => {
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
      ['a search that isn’t an object', { search: [] }, /^search /],
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
      search?: boolean;
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
          search ? JSON.stringify(SEARCH_DETAILS) : null,
          search ? JSON.stringify(SEARCH_PICK.search.rosterDetails) : null,
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
      ['a match with no student', () => ({ kind: 'match', resultId, ordinal: 0 })],
      [
        'a match with no suggestion or search',
        () => ({ kind: 'match', studentUniqueId: 'SUID-1' }),
      ],
      [
        'a match with both a suggestion and a search',
        () => ({ kind: 'match', studentUniqueId: 'SUID-1', resultId, ordinal: 0, search: true }),
      ],
      ['an exclude with a student', () => ({ kind: 'exclude', studentUniqueId: 'SUID-1' })],
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
