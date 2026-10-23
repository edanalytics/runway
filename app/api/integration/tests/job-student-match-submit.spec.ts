import request from 'supertest';
import { IdMatchingMode, RunStatus } from '@prisma/client';
import {
  GetJobDto,
  GetStudentInputDetailsDto,
  MATCH_REVIEW_STUDENT_LIMIT,
} from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
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
import { holdJobRow } from '../helpers/db/hold-job-row';
import { waitUntilBlockedBy } from '../helpers/db/wait-until-blocked-by';

describe('POST /jobs/:jobId/student-match-results/submit', () => {
  const PARTNER_ADMIN = ['runway.test.user', 'runway.test.partneradmin'];
  const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];
  const ECS_TASK_ARN = 'arn:aws:ecs:us-east-1:123456789012:task/cluster/abc123';
  /** The job's school year, 2024–25, by its end year. */
  const JOB_YEAR = 2025;
  /** The refusal for stale versions, at these positions in the request. */
  const decisionChanged = (indices: number[]) => ({
    statusCode: 409,
    code: 'decision_changed',
    message: 'A student’s decision has changed since the page loaded.',
    indices,
  });
  const FULL_RUN_NOT_DONE = {
    statusCode: 409,
    code: 'full_run_not_done',
    message: 'The job’s full run hasn’t succeeded.',
  };
  /** The refusal for students already in a send run, at these positions in the request. */
  const alreadySubmitted = (indices: number[]) => ({
    statusCode: 409,
    code: 'already_submitted',
    message: 'A student’s match has already been submitted.',
    indices,
  });
  /** The refusal for students whose decision isn't a match, at these positions in the request. */
  const notAMatch = (indices: number[]) => ({
    statusCode: 409,
    code: 'not_a_match',
    message: 'A student’s decision isn’t a match.',
    indices,
  });
  /** The refusal for matches without valid school years, at these positions in the request. */
  const invalidSchoolYears = (indices: number[]) => ({
    statusCode: 409,
    code: 'invalid_school_years',
    message: 'A student’s match has no valid school years.',
    indices,
  });

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

  /** Each student's status, as the review read shows it. */
  const statusesOf = async (jobId: number, cookie: string) => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/student-match-results`)
      .set('Cookie', [cookie]);
    return Object.fromEntries(
      res.body.students.map(({ correlationId, status }: GetStudentInputDetailsDto) => [
        correlationId,
        status,
      ])
    );
  };

  /** Ends a send run, as the Executor reports its outcome. */
  const endSendRun = (runId: number, status: 'success' | 'error') =>
    prisma.run.update({ where: { id: runId }, data: { status } });

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
      // The Executor's init call reads the run and its decisions on another
      // connection, so they must be committed by the time it's launched.
      let decisionsAtLaunch: [string, number][] | undefined;
      executorStart.mockImplementation(async ({ id }: { id: number }) => {
        const rows = await prisma.sendRunDecision.findMany({
          where: { runId: id },
          orderBy: { correlationId: 'asc' },
        });
        decisionsAtLaunch = rows.map(({ correlationId, seq }) => [correlationId, seq]);
        return { ecsTaskArn: ECS_TASK_ARN, taskSize: 'medium' };
      });

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
      expect(res.body).toEqual({ runId: sendRun.id, launched: true });
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
      expect(decisionsAtLaunch).toEqual([
        ['corr-1', 1],
        ['corr-2', 3],
      ]);
    });

    // The send run routes a match outside the job's year to sideloading.
    it('accepts a match to a search outside the job’s year', async () => {
      const v1 = await matchSearch(job.id, 'corr-1', { school_years: [JOB_YEAR - 6] }, cookies);

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(res.status).toBe(201);
      expect(await sendRunsOf(job.id)).toHaveLength(1);
    });

    // The send run and its decisions are committed before the launch, so its
    // students are in it though it never started.
    it('still returns the send run when it fails to start, recording the failure, and its students read as run-failed', async () => {
      executorStart.mockRejectedValue(new Error('ECS is unavailable'));
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(res.status).toBe(201);
      const [sendRun] = await sendRunsOf(job.id);
      expect(res.body).toEqual({ runId: sendRun.id, launched: false });
      expect(sendRun.status).toBe('error');
      expect(sendRun.sendRunDecision.map(({ correlationId }) => correlationId)).toEqual(['corr-1']);
      expect(await prisma.runError.findMany({ where: { runId: sendRun.id } })).toEqual([
        expect.objectContaining({ code: 'failed_to_start_executor' }),
      ]);
      expect((await statusesOf(job.id, cookies))['corr-1']).toBe('run-failed');
    });
  });

  describe('authorization', () => {
    it('refuses a user from another tenant', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const { cookies: other } = await authHelper.login(idpA, userB, tenantB);

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], other);

      expect(res.status).toBe(403);
      expect(await sendRunsOf(job.id)).toEqual([]);
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
  });

  describe('the job’s full run', () => {
    it.each<RunStatus>(['new', 'running', 'error'])(
      'must have succeeded: refuses a submit while it is %s',
      async (fullRunStatus) => {
        const other = await seedReportedJob({ fullRunStatus });
        const v1 = await matchSuggestion(other.id, 'corr-1', cookies);

        const res = await submit(other.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

        expect(res.status).toBe(409);
        expect(res.body).toEqual(FULL_RUN_NOT_DONE);
        expect(await sendRunsOf(other.id)).toEqual([]);
      }
    );

    // The send run is the job's latest run, and still new.
    it('ignores send runs: accepts a submit while an earlier submit’s send run is in progress', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const v2 = await matchSuggestion(job.id, 'corr-2', cookies);
      await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      const res = await submit(job.id, [{ correlationId: 'corr-2', version: v2 }], cookies);

      expect(res.status).toBe(201);
      expect(await sendRunsOf(job.id)).toHaveLength(2);
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
      expect(res.body).toEqual(decisionChanged([1]));
      expect(await sendRunsOf(job.id)).toEqual([]);
    });

    // An undecided student has no version, so any version is stale.
    it('names every stale position, including an undecided student’s', async () => {
      await matchSuggestion(job.id, 'corr-1', cookies);
      await matchSuggestion(job.id, 'corr-1', cookies, 1);
      const v2 = await matchSuggestion(job.id, 'corr-2', cookies);

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: 1 },
          { correlationId: 'corr-2', version: v2 },
          { correlationId: 'corr-3', version: 1 },
        ],
        cookies
      );

      expect(res.status).toBe(409);
      expect(res.body).toEqual(decisionChanged([0, 2]));
      expect(await sendRunsOf(job.id)).toEqual([]);
    });
  });

  describe('a student whose send run hasn’t failed', () => {
    // Two reviewers submitting the same student; the race test below sends
    // them at once.
    it('refuses, submitting nothing more, naming every such student’s position', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const v2 = await matchSuggestion(job.id, 'corr-2', cookies);
      const v3 = await matchSuggestion(job.id, 'corr-3', cookies);
      await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: v1 },
          { correlationId: 'corr-3', version: v3 },
        ],
        cookies
      );

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: v1 },
          { correlationId: 'corr-2', version: v2 },
          { correlationId: 'corr-3', version: v3 },
        ],
        cookies
      );

      expect(res.status).toBe(409);
      expect(res.body).toEqual(alreadySubmitted([0, 2]));
      expect(await sendRunsOf(job.id)).toHaveLength(1);
    });

    // A page showing a match that another reviewer has since changed and
    // submitted is refused for what it showed, not for a decision it never saw.
    it('reports a stale version first', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const v2 = await matchSuggestion(job.id, 'corr-1', cookies, v1);
      await submit(job.id, [{ correlationId: 'corr-1', version: v2 }], cookies);

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(res.status).toBe(409);
      expect(res.body).toEqual(decisionChanged([0]));
      expect(await sendRunsOf(job.id)).toHaveLength(1);
    });

    it('refuses reprocessing and reprocessed students, naming their positions, but not run-failed ones', async () => {
      const students = [];
      for (const correlationId of ['corr-1', 'corr-2', 'corr-3']) {
        students.push({
          correlationId,
          version: await matchSuggestion(job.id, correlationId, cookies),
        });
      }
      await submit(job.id, [students[0]], cookies);
      const sent = await submit(job.id, [students[1]], cookies);
      await endSendRun(sent.body.runId, 'success');
      const failed = await submit(job.id, [students[2]], cookies);
      await endSendRun(failed.body.runId, 'error');
      expect(await statusesOf(job.id, cookies)).toEqual({
        'corr-1': 'reprocessing',
        'corr-2': 'reprocessed',
        'corr-3': 'run-failed',
      });

      const res = await submit(job.id, students, cookies);

      expect(res.status).toBe(409);
      expect(res.body).toEqual(alreadySubmitted([0, 1]));
      expect(await sendRunsOf(job.id)).toHaveLength(3);
    });
  });

  // Decisions refuse a student once they're in any send run, so a failed
  // send's students can only be sent again, with the same decision row.
  describe('a student whose send run failed', () => {
    /** Submits the students' matches, and has the send run fail as the Executor reports it. */
    const submitAndFail = async (
      jobId: number,
      students: { correlationId: string; version: number }[],
      cookie: string
    ) => {
      const res = await submit(jobId, students, cookie);
      await endSendRun(res.body.runId, 'error');
      return res.body.runId as number;
    };

    it('submits them again, in a new send run of the same decision row, and they read as reprocessing', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const failedRunId = await submitAndFail(
        job.id,
        [{ correlationId: 'corr-1', version: v1 }],
        cookies
      );

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ runId: expect.any(Number), launched: true });
      expect(
        (await sendRunsOf(job.id)).map(({ id, status, sendRunDecision }) => ({
          id,
          status,
          decisions: sendRunDecision.map(({ correlationId, seq }) => [correlationId, seq]),
        }))
      ).toEqual([
        { id: failedRunId, status: 'error', decisions: [['corr-1', v1]] },
        { id: res.body.runId, status: 'new', decisions: [['corr-1', v1]] },
      ]);
      expect((await statusesOf(job.id, cookies))['corr-1']).toBe('reprocessing');
    });

    it('submits them again after their send run failed to start', async () => {
      executorStart.mockRejectedValueOnce(new Error('ECS is unavailable'));
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const failed = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);
      expect(failed.body.launched).toBe(false);

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      expect(res.status).toBe(201);
      expect(res.body.launched).toBe(true);
      expect((await sendRunsOf(job.id)).map(({ status }) => status)).toEqual(['error', 'new']);
    });

    it('sends them in one send run with ready students', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      const v2 = await matchSuggestion(job.id, 'corr-2', cookies);
      await submitAndFail(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: v1 },
          { correlationId: 'corr-2', version: v2 },
        ],
        cookies
      );

      expect(res.status).toBe(201);
      const resent = (await sendRunsOf(job.id)).find(({ id }) => id === res.body.runId);
      expect(resent?.sendRunDecision.map(({ correlationId, seq }) => [correlationId, seq])).toEqual(
        [
          ['corr-1', v1],
          ['corr-2', v2],
        ]
      );
    });

    it('gives a student raced by two resubmits to exactly one new send run', async () => {
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      await submitAndFail(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);
      const holder = await holdJobRow(job.id);
      try {
        // then() sends each request now, rather than when it's awaited.
        const pending = [1, 2].map(() =>
          submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies).then((res) => res)
        );
        await waitUntilBlockedBy(holder.pid, 2);
        await holder.client.query('ROLLBACK');
        const responses = await Promise.all(pending);

        expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
        expect(responses.find((res) => res.status === 409)?.body).toEqual(alreadySubmitted([0]));
        expect((await sendRunsOf(job.id)).map(({ status }) => status)).toEqual(['error', 'new']);
      } finally {
        await holder.release();
      }
    });

    it('clears the job’s complete with errors once they’re sent again successfully', async () => {
      const jobStatus = async () =>
        plainToInstance(
          GetJobDto,
          (await request(app.getHttpServer()).get(`/jobs/${job.id}`).set('Cookie', [cookies])).body
        ).status;
      await decide(job.id, 'corr-2', { replacesVersion: null, kind: 'exclude' }, cookies);
      await decide(job.id, 'corr-3', { replacesVersion: null, kind: 'exclude' }, cookies);
      const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
      await submitAndFail(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);
      expect(await jobStatus()).toBe('complete with errors');

      const res = await submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies);
      await endSendRun(res.body.runId, 'success');

      expect(await jobStatus()).toBe('success');
    });
  });

  describe('a current decision that isn’t a match', () => {
    // The page sends only matches, so these are hand-made requests.
    it('refuses, submitting nothing, naming every such student’s position', async () => {
      const excluded = await decide(
        job.id,
        'corr-1',
        { replacesVersion: null, kind: 'exclude' },
        cookies
      );
      const v2 = await matchSuggestion(job.id, 'corr-2', cookies);
      await matchSuggestion(job.id, 'corr-3', cookies);
      await decide(job.id, 'corr-3', { replacesVersion: 1, kind: 'clear' }, cookies);
      // A clear is the decision's next version.
      const cleared = 2;

      const res = await submit(
        job.id,
        [
          { correlationId: 'corr-1', version: excluded },
          { correlationId: 'corr-2', version: v2 },
          { correlationId: 'corr-3', version: cleared },
        ],
        cookies
      );

      expect(res.status).toBe(409);
      expect(res.body).toEqual(notAMatch([0, 2]));
      expect(await sendRunsOf(job.id)).toEqual([]);
    });
  });

  describe('school years', () => {
    // On a suggestion. The test below shows a search's school years are checked too.
    it.each<[string, object]>([
      ['missing', {}],
      ['not an array', { school_years: JOB_YEAR }],
      ['holding a non-integer', { school_years: [JOB_YEAR, String(JOB_YEAR + 1)] }],
    ])(
      'refuses, submitting nothing, a match whose school years are %s',
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
        expect(res.body).toEqual(invalidSchoolYears([1]));
        expect(await sendRunsOf(job.id)).toEqual([]);
      }
    );

    // The reviewer can exclude those students and submit the rest.
    it('names every failing student’s position, for either basis, and accepts the rest once they’re excluded', async () => {
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

      expect(refused.body).toEqual(invalidSchoolYears([0, 2]));
      expect(accepted.status).toBe(201);
    });
  });

  // Two reviewers submit the same student at once. Both requests are held
  // behind a job-row lock until both are waiting, so they race every time.
  it('gives a student raced by two submits to exactly one send run', async () => {
    const v1 = await matchSuggestion(job.id, 'corr-1', cookies);
    const holder = await holdJobRow(job.id);
    try {
      // then() sends each request now, rather than when it's awaited.
      const pending = [1, 2].map(() =>
        submit(job.id, [{ correlationId: 'corr-1', version: v1 }], cookies).then((res) => res)
      );
      await waitUntilBlockedBy(holder.pid, 2);
      await holder.client.query('ROLLBACK');
      const responses = await Promise.all(pending);

      expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(responses.find((res) => res.status === 409)?.body).toEqual(alreadySubmitted([0]));
      expect((await sendRunsOf(job.id)).map((run) => run.sendRunDecision.length)).toEqual([1]);
    } finally {
      await holder.release();
    }
  });
});
