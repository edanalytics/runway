import request from 'supertest';
import { IdMatchingMode, RunStatus } from '@prisma/client';
import { MATCH_REVIEW_STUDENT_LIMIT } from '@edanalytics/models';
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
import { waitUntilBlockedBy } from '../helpers/db/wait-until-blocked-by';

describe('POST /jobs/:jobId/student-match-results/submit', () => {
  const PARTNER_ADMIN = ['runway.test.user', 'runway.test.partneradmin'];
  const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];
  const ECS_TASK_ARN = 'arn:aws:ecs:us-east-1:123456789012:task/cluster/abc123';
  /** The job's school year, 2024–25, by its end year. */
  const JOB_YEAR = 2025;
  const DECISION_CHANGED = {
    statusCode: 409,
    code: 'decision_changed',
    message: 'A student’s decision has changed since the page loaded.',
  };
  const NOT_READY = {
    statusCode: 409,
    code: 'not_ready',
    message: 'A student has no match ready to submit.',
  };

  let job: Awaited<ReturnType<typeof seedJob>>;
  let cookies: string;
  let executorStart: jest.SpyInstance;

  /**
   * A job with corr-1, corr-2 and corr-3 reported for review by its full run,
   * each with one suggestion in the job's year.
   */
  const seedReportedJob = async ({
    idMatchingMode = 'fuzzy',
    fullRunStatus = 'success',
    inTenantB = false,
  }: { idMatchingMode?: IdMatchingMode; fullRunStatus?: RunStatus; inTenantB?: boolean } = {}) => {
    const seeded = await seedJob({
      odsConfig: inTenantB ? odsConfigB2526 : odsConfigA2425,
      bundle: bundleA,
      tenant: inTenantB ? tenantB : tenantA,
      idMatchingMode,
      runStatus: fullRunStatus,
    });
    await reportStudents(seeded.runs[0].id, {
      'corr-1': { school_years: [JOB_YEAR] },
      'corr-2': { school_years: [JOB_YEAR] },
      'corr-3': { school_years: [JOB_YEAR] },
    });
    return seeded;
  };

  /** Reports each student with one suggestion, with these roster details. */
  const reportStudents = (runId: number, rosterDetailsOf: Record<string, object>) =>
    reportMatchResults(
      runId,
      Object.entries(rosterDetailsOf).map(([correlationId, rosterDetails]) => ({
        correlation_id: correlationId,
        candidate: { first_name: 'Ada' },
        matches: [{ student_unique_id: `SUID-${correlationId}`, score: 0.9, ...rosterDetails }],
      }))
    );

  const submit = (jobId: number, students: unknown, cookie: string) =>
    request(app.getHttpServer())
      .post(`/jobs/${jobId}/student-match-results/submit`)
      .set('Cookie', [cookie])
      .send({ students });

  /** Saves a decision as a reviewer does, and returns its version (null after a clear). */
  const decide = async (
    jobId: number,
    correlationId: string,
    body: Record<string, unknown>,
    cookie: string
  ) => {
    const res = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/student-match-results/${correlationId}/decisions`)
      .set('Cookie', [cookie])
      .send(body);
    expect(res.status).toBe(201);
    return (res.body.decision?.version ?? null) as number | null;
  };

  /** Matches the student to their suggestion, replacing `replacesVersion`, and returns the version. */
  const matchSuggestion = async (
    jobId: number,
    correlationId: string,
    cookie: string,
    replacesVersion: number | null = null
  ) => {
    const { id } = await prisma.studentMatchResult.findFirstOrThrow({
      where: { jobId, correlationId },
      orderBy: { runId: 'desc' },
    });
    return decide(
      jobId,
      correlationId,
      { replacesVersion, kind: 'match', resultId: id.toString(), ordinal: 0 },
      cookie
    ) as Promise<number>;
  };

  /** Matches the student to one the reviewer found by searching, and returns the version. */
  const matchSearch = (
    jobId: number,
    correlationId: string,
    rosterDetails: object,
    cookie: string
  ) =>
    decide(
      jobId,
      correlationId,
      {
        replacesVersion: null,
        kind: 'match',
        studentUniqueId: 'SUID-FOUND',
        search: { searchDetails: { first_name: 'Ada' }, rosterDetails },
      },
      cookie
    ) as Promise<number>;

  /** The job's send runs, each with the decision rows it delivers. */
  const sendRunsOf = (jobId: number) =>
    prisma.run.findMany({
      where: { jobId, kind: 'send' },
      orderBy: { id: 'asc' },
      include: { sendRunDecision: { orderBy: { correlationId: 'asc' } } },
    });

  beforeEach(async () => {
    executorStart = jest
      .spyOn(ExecutorAwsService.prototype, 'start')
      .mockResolvedValue({ ecsTaskArn: ECS_TASK_ARN, taskSize: 'medium' });
    job = await seedReportedJob();
    ({ cookies } = await authHelper.login(idpA, userA, tenantA));
  });

  afterEach(() => {
    executorStart.mockRestore();
  });

  describe('a submit', () => {
    it('starts a send run of exactly the submitted decisions, created by the submitter', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      // corr-2's match is its third decision, so its version is 3.
      await decide(job.id, 'corr-2', { replacesVersion: null, kind: 'exclude' }, cookies);
      await decide(job.id, 'corr-2', { replacesVersion: 1, kind: 'clear' }, cookies);
      const v3 = await matchSuggestion(job.id, 'corr-2', cookies);

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: v1 },
          { correlationId: 'corr-2', version: v3 },
        ],
        cookies
      );

      expect(res.status).toBe(201);
      const [sendRun] = await sendRunsOf(job.id);
      expect(res.body).toEqual({ runId: sendRun.id });
      expect(sendRun).toMatchObject({
        status: 'new',
        createdById: userA.id,
        ecsTaskArn: ECS_TASK_ARN,
      });
      expect(sendRun.sendRunDecision.map(({ correlationId, seq }) => [correlationId, seq])).toEqual(
        [
          ['corr-1', 1],
          ['corr-2', 3],
        ]
      );
      expect(executorStart).toHaveBeenCalledTimes(1);
      expect(executorStart.mock.calls[0][0]).toMatchObject({ id: sendRun.id, kind: 'send' });

      const read = await request(app.getHttpServer())
        .get(`/jobs/${job.id}/student-match-results`)
        .set('Cookie', [cookies]);
      expect(
        read.body.students.map(({ correlationId, status }: Record<string, string>) => [
          correlationId,
          status,
        ])
      ).toEqual([
        ['corr-1', 'reprocessing'],
        ['corr-2', 'reprocessing'],
        ['corr-3', 'to-review'],
      ]);
    });

    // The send run routes a match outside the job's year to sideloading.
    it('accepts a match to a search, and a match outside the job’s year', async () => {
      const v1 = await matchSearch(job.id, 'corr-1', { school_years: [JOB_YEAR - 6] }, cookies);

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(res.status).toBe(201);
      expect(await sendRunsOf(job.id)).toHaveLength(1);
    });

    // A second submit while the first one's send run is still going.
    it('accepts a submit while another send run is in progress', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const v2 = await matchSuggestion(job.id, 'corr-2', cookies);
      await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      const res = await submit(job.id, [{ correlationId: 'corr-2', version: v2 }], cookies);

      expect(res.status).toBe(201);
      expect(await sendRunsOf(job.id)).toHaveLength(2);
    });

    // The send run and its decisions are committed before the launch, and the
    // students are already reprocessing.
    it('still returns the send run when it fails to start, recording the failure', async () => {
      executorStart.mockRejectedValue(new Error('ECS is unavailable'));
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(res.status).toBe(201);
      const [sendRun] = await sendRunsOf(job.id);
      expect(res.body).toEqual({ runId: sendRun.id });
      expect(sendRun.status).toBe('error');
      expect(sendRun.sendRunDecision.map(({ correlationId }) => correlationId)).toEqual(['corr-1']);
      expect(await prisma.runError.findMany({ where: { runId: sendRun.id } })).toEqual([
        expect.objectContaining({ code: 'failed_to_start_executor' }),
      ]);
    });
  });

  describe('authorization', () => {
    it('refuses a user from another tenant', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const { cookies: other } = await authHelper.login(idpA, userB, tenantB);

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], other);

      expect(res.status).toBe(403);
    });

    it('refuses a user without the submit privilege', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);

      // Every role has it, so take it from the session.
      const res = await withoutPrivilege('job.match-results.submit', () =>
        submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies)
      );

      expect(res.status).toBe(403);
      expect(await sendRunsOf(job.id)).toEqual([]);
    });

    describe('a support user in a global tenant, for a job in another tenant', () => {
      let tenantBJob: Awaited<ReturnType<typeof seedJob>>;
      let support: string;
      let v1: number;
      beforeEach(async () => {
        tenantBJob = await seedReportedJob({ inTenantB: true });
        ({ cookies: support } = await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_USER));
        v1 = await matchSuggestion(tenantBJob.id, 'corr-1', support);
      });

      it('may submit', async () => {
        const res = await submit(
          tenantBJob.id,
          [{ correlationId: 'corr-1', version: v1 }],
          support
        );

        expect(res.status).toBe(201);
      });

      it('may not, without the metatenant submit privilege', async () => {
        const res = await withoutPrivilege('job.metatenant.match-results.submit', () =>
          submit(tenantBJob.id, [{ correlationId: 'corr-1', version: v1 }], support)
        );

        expect(res.status).toBe(403);
        expect(await sendRunsOf(tenantBJob.id)).toEqual([]);
      });
    });

    it.each<IdMatchingMode>(['id_based_fuzzy_background', 'id_based'])(
      'refuses a job in %s mode, even from a partner admin',
      async (mode) => {
        const other = await seedReportedJob({ idMatchingMode: mode });
        const { cookies: admin } = await authHelper.login(idpA, userA, tenantA, PARTNER_ADMIN);

        const res = await submit(other.id, [{ correlationId: 'corr-1', version: 1 }], admin);

        expect(res.status).toBe(403);
        expect(await sendRunsOf(other.id)).toEqual([]);
      }
    );

    // The body is validated before the mode is checked.
    it('refuses a malformed body as a 400 on a job in id_based mode', async () => {
      const other = await seedReportedJob({ idMatchingMode: 'id_based' });

      const res = await submit(other.id, [], cookies);

      expect(res.status).toBe(400);
    });
  });

  describe('a bad request', () => {
    it.each<[string, unknown]>([
      ['no students', undefined],
      ['an empty list of students', []],
      [
        'the same student twice',
        [
          { correlationId: 'corr-1', version: 1 },
          { correlationId: 'corr-1', version: 1 },
        ],
      ],
      // Only a match can be submitted, and every match has a version.
      ['a null version', [{ correlationId: 'corr-1', version: null }]],
      ['version 0', [{ correlationId: 'corr-1', version: 0 }]],
      ['a fractional version', [{ correlationId: 'corr-1', version: 1.5 }]],
      ['a version out of INTEGER range', [{ correlationId: 'corr-1', version: 2 ** 31 }]],
      ['an empty correlation id', [{ correlationId: '', version: 1 }]],
      ['a correlation id over 128 characters', [{ correlationId: 'c'.repeat(129), version: 1 }]],
      // PostgreSQL text can't hold one, so it must not reach a query.
      ['a correlation id with a NUL', [{ correlationId: 'corr-1\u0000', version: 1 }]],
      [
        'more students than the review limit',
        Array.from({ length: MATCH_REVIEW_STUDENT_LIMIT + 1 }, (_, i) => ({
          correlationId: `corr-${i}`,
          version: 1,
        })),
      ],
    ])('refuses %s', async (_, students) => {
      const res = await submit(job.id, students, cookies);

      expect(res.status).toBe(400);
    });
  });

  it('returns 404, submitting nothing, for a student the job doesn’t have', async () => {
    const v1 = await matchSuggestion(job.id, 'corr-1', cookies);

    const res = await submit(
      job.id,
      [
        { correlationId: 'corr-1', version: v1 },
        { correlationId: 'corr-unknown', version: 1 },
      ],
      cookies
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'not_found',
      message: 'A student isn’t in the job.',
    });
    expect(await sendRunsOf(job.id)).toEqual([]);
    expect(executorStart).not.toHaveBeenCalled();
  });

  describe('the job’s full run', () => {
    it.each<RunStatus>(['new', 'running', 'error'])(
      'must have succeeded: refuses a submit while it is %s',
      async (fullRunStatus) => {
        const other = await seedReportedJob({ fullRunStatus });
        const v1 = await matchSuggestion(other.id, 'corr-1', cookies);

        const res = await submit(other.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          statusCode: 409,
          code: 'full_run_not_done',
          message: 'The job’s full run hasn’t succeeded.',
        });
        expect(await sendRunsOf(other.id)).toEqual([]);
      }
    );

    it('is the latest one: accepts a submit once a re-run succeeds after a failure', async () => {
      const other = await seedReportedJob({ fullRunStatus: 'error' });
      await prisma.run.create({ data: { jobId: other.id, kind: 'full', status: 'success' } });
      const v1 = await matchSuggestion(other.id, 'corr-1', cookies);

      const res = await submit(other.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(res.status).toBe(201);
    });
  });

  describe('the version check', () => {
    // corr-2's current decision is version 2.
    it.each([
      ['behind', 1],
      ['ahead of', 3],
    ])('refuses, submitting nothing, a version %s the current one', async (_, version) => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      await matchSuggestion(job.id, 'corr-2', cookies);
      await matchSuggestion(job.id, 'corr-2', cookies, 1);

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: v1 },
          { correlationId: 'corr-2', version },
        ],
        cookies
      );

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
      expect(await sendRunsOf(job.id)).toEqual([]);
    });

    // An undecided student has no version, so any version is stale.
    it('refuses a student with no decision', async () => {
      const res = await submit(job.id, [{ correlationId: 'corr-1', version: 1 }], cookies);

      expect(res.status).toBe(409);
      expect(res.body).toEqual(DECISION_CHANGED);
    });
  });

  describe('the student’s current decision', () => {
    it.each<[string, () => Promise<number>]>([
      [
        'excluded',
        async () =>
          (await decide(job.id, 'corr-2', { replacesVersion: null, kind: 'exclude' }, cookies))!,
      ],
      [
        'with a cleared match',
        async () => {
          await matchSuggestion(job.id, 'corr-2', cookies);
          await decide(job.id, 'corr-2', { replacesVersion: 1, kind: 'clear' }, cookies);
          // A clear is the decision's next version.
          return 2;
        },
      ],
      [
        'already submitted',
        async () => {
          const version = await matchSuggestion(job.id, 'corr-2', cookies);
          await submit(job.id, [{ correlationId: 'corr-2', version }], cookies);
          return version;
        },
      ],
    ])('refuses, submitting nothing, a student %s', async (_, currentVersion) => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const version = await currentVersion();
      const sendRunsBefore = (await sendRunsOf(job.id)).length;

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: v1 },
          { correlationId: 'corr-2', version },
        ],
        cookies
      );

      expect(res.status).toBe(409);
      expect(res.body).toEqual(NOT_READY);
      expect(await sendRunsOf(job.id)).toHaveLength(sendRunsBefore);
    });
  });

  describe('school years', () => {
    const MALFORMED: [string, object][] = [
      ['missing', {}],
      ['not an array', { school_years: JOB_YEAR }],
      ['holding a non-integer', { school_years: [JOB_YEAR, String(JOB_YEAR + 1)] }],
    ];

    it.each(MALFORMED)(
      'refuses, submitting nothing, a match to a suggestion whose school years are %s',
      async (_, rosterDetails) => {
        await reportStudents(job.runs[0].id, { 'corr-bad': rosterDetails });
        const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
        const bad = await matchSuggestion(job.id, 'corr-bad', cookies);

        const res = await submit(
          job.id,
          [
            { correlationId: 'corr-1', version: v1 },
            { correlationId: 'corr-bad', version: bad },
          ],
          cookies
        );

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          statusCode: 409,
          code: 'invalid_school_years',
          message: 'A student’s match has no valid school years.',
          indices: [1],
        });
        expect(await sendRunsOf(job.id)).toEqual([]);
      }
    );

    it.each(MALFORMED)(
      'refuses, submitting nothing, a match to a search whose school years are %s',
      async (_, rosterDetails) => {
        const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
        const bad = await matchSearch(job.id, 'corr-2', rosterDetails, cookies);

        const res = await submit(
          job.id,
          [
            { correlationId: 'corr-1', version: v1 },
            { correlationId: 'corr-2', version: bad },
          ],
          cookies
        );

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'invalid_school_years', indices: [1] });
        expect(await sendRunsOf(job.id)).toEqual([]);
      }
    );

    // The reviewer can exclude those students and submit the rest.
    it('names every failing student’s position, and accepts the rest once they’re excluded', async () => {
      await reportStudents(job.runs[0].id, { 'corr-bad': {} });
      const bad1 = await matchSuggestion(job.id, 'corr-bad', cookies);
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const bad2 = await matchSearch(job.id, 'corr-2', { school_years: 'none' }, cookies);

      const refused = await submit(
        job.id,
        [
          { correlationId: 'corr-bad', version: bad1 },
          { correlationId: 'corr-1', version: v1 },
          { correlationId: 'corr-2', version: bad2 },
        ],
        cookies
      );
      await decide(job.id, 'corr-bad', { replacesVersion: bad1, kind: 'exclude' }, cookies);
      await decide(job.id, 'corr-2', { replacesVersion: bad2, kind: 'exclude' }, cookies);
      const accepted = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(refused.body).toMatchObject({ code: 'invalid_school_years', indices: [0, 2] });
      expect(accepted.status).toBe(201);
    });
  });

  // Each request has two faults, and gets the earlier check's refusal.
  describe('the order of the checks', () => {
    it('reports an unknown student before a full run that hasn’t succeeded', async () => {
      const other = await seedReportedJob({ fullRunStatus: 'running' });

      const res = await submit(other.id, [{ correlationId: 'corr-unknown', version: 1 }], cookies);

      expect(res.body.code).toBe('not_found');
    });

    it('reports a full run that hasn’t succeeded before a stale version', async () => {
      const other = await seedReportedJob({ fullRunStatus: 'running' });

      const res = await submit(other.id, [{ correlationId: 'corr-1', version: 1 }], cookies);

      expect(res.body.code).toBe('full_run_not_done');
    });

    it('reports a stale version before a student without a match', async () => {
      await decide(job.id, 'corr-1', { replacesVersion: null, kind: 'exclude' }, cookies);

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: 1 },
          { correlationId: 'corr-2', version: 1 },
        ],
        cookies
      );

      expect(res.body.code).toBe('decision_changed');
    });

    it('reports a student without a match before invalid school years', async () => {
      await decide(job.id, 'corr-1', { replacesVersion: null, kind: 'exclude' }, cookies);
      const bad = await matchSearch(job.id, 'corr-2', {}, cookies);

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: 1 },
          { correlationId: 'corr-2', version: bad },
        ],
        cookies
      );

      expect(res.body.code).toBe('not_ready');
    });
  });

  // Two reviewers submit the same student at once. Both requests are held
  // behind a job-row lock until both are waiting, so they race every time.
  it('gives a student raced by two submits to exactly one send run', async () => {
    const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
    const holder = await pool().connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM public.job WHERE id = $1 FOR NO KEY UPDATE', [job.id]);
      const { rows } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');

      // then() sends each request now, rather than when it's awaited.
      const pending = [1, 2].map(() =>
        submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies).then((res) => res)
      );
      await waitUntilBlockedBy(rows[0].pid, 2);
      await holder.query('ROLLBACK');
      const responses = await Promise.all(pending);

      expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(responses.find((res) => res.status === 409)?.body).toEqual(NOT_READY);
      expect((await sendRunsOf(job.id)).map((run) => run.sendRunDecision.length)).toEqual([1]);
    } finally {
      // Releases the lock if the test failed before the rollback.
      await holder.query('ROLLBACK');
      holder.release();
    }
  });
});
