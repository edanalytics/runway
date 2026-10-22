import request from 'supertest';
import { IdMatchingMode, Job, Run, RunStatus } from '@prisma/client';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigB2526 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantB, tenantDGlobal } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB } from '../fixtures/user-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { GetJobDto, GetStudentInputDetailsDto } from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { JobsService } from 'api/src/jobs/jobs.service';
import { reportMatchResults as report } from '../helpers/report-match-results';
import { withoutPrivilege } from '../helpers/without-privilege';

describe('GET /jobs/:jobId/student-match-results', () => {
  let jobA: Job;
  let runA: Run;
  let endpoint: string;

  /** Save a decision through the API, as a reviewer does. */
  const decide = async (
    cookies: string,
    correlationId: string,
    body: Record<string, unknown>,
    jobId = jobA.id
  ) => {
    const res = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/student-match-results/${correlationId}/decisions`)
      .set('Cookie', [cookies])
      .send(body);
    expect(res.status).toBe(201);
  };

  /** A send run of each student's latest decision, as submitting creates one. */
  const seedSendRun = async (jobId: number, correlationIds: string[], status: RunStatus) => {
    const run = await prisma.run.create({ data: { jobId, kind: 'send', status } });
    const decisions = await Promise.all(
      correlationIds.map((correlationId) =>
        prisma.studentMatchDecision.findFirstOrThrow({
          where: { jobId, correlationId },
          orderBy: { seq: 'desc' },
        })
      )
    );
    await prisma.sendRunDecision.createMany({
      data: decisions.map(({ correlationId, seq }) => ({
        runId: run.id,
        jobId,
        correlationId,
        seq,
      })),
    });
  };

  const resultIdOf = async (correlationId: string, runId = runA.id, jobId = jobA.id) =>
    (
      await prisma.studentMatchResult.findUniqueOrThrow({
        where: { jobId_correlationId_runId: { jobId, correlationId, runId } },
      })
    ).id.toString();

  /** Students with one suggestion each, reported by the job's full run. */
  const reportStudents = (correlationIds: string[], runId = runA.id) =>
    report(
      runId,
      correlationIds.map((correlation_id) => ({
        correlation_id,
        candidate: { first_name: 'Ada' },
        matches: [{ student_unique_id: `SUID-${correlation_id}`, score: 0.5 }],
      }))
    );

  beforeEach(async () => {
    const seeded = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
      idMatchingMode: 'fuzzy',
    });
    jobA = seeded;
    runA = seeded.runs[0];
    endpoint = `/jobs/${jobA.id}/student-match-results`;
  });

  describe('authentication and authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get(endpoint);

      expect(res.status).toBe(401);
    });

    it('rejects a user from another tenant', async () => {
      const { cookies } = await authHelper.login(idpA, userB, tenantB);

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

      expect(res.status).toBe(403);
    });

    it('rejects a user without the match results privilege', async () => {
      // Every role has it, so take it from the session.
      const { cookies } = await authHelper.login(idpA, userA, tenantA);

      const res = await withoutPrivilege('job.match-results.read', () =>
        request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies])
      );

      expect(res.status).toBe(403);
    });
  });

  describe('for the job’s tenant', () => {
    let cookies: string;
    beforeEach(async () => {
      ({ cookies } = await authHelper.login(idpA, userA, tenantA));
    });

    it('returns each student with its result and suggestions', async () => {
      await report(runA.id, [
        {
          correlation_id: 'corr-1',
          candidate: { first_name: 'Ada', last_name: 'Lovelace' },
          matches: [
            { student_unique_id: 'SUID-1', score: 0.97, first_name: 'Ada' },
            { student_unique_id: 'SUID-2', score: 0.42, first_name: 'Adah' },
          ],
        },
        { correlation_id: 'corr-2', candidate: { first_name: 'Grace' }, matches: [] },
      ]);

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        counts: { total: 2, toReview: 2, ready: 0, excluded: 0, submitted: 0 },
        students: [
          {
            correlationId: 'corr-1',
            sourceRunId: runA.id,
            createdOn: expect.any(String),
            inputDetails: { first_name: 'Ada', last_name: 'Lovelace' },
            status: 'to-review',
            decision: null,
            results: [
              {
                id: expect.any(String),
                runId: runA.id,
                createdOn: expect.any(String),
                suggestions: [
                  {
                    ordinal: 0,
                    studentUniqueId: 'SUID-1',
                    score: 0.97,
                    rosterDetails: { first_name: 'Ada' },
                  },
                  {
                    ordinal: 1,
                    studentUniqueId: 'SUID-2',
                    score: 0.42,
                    rosterDetails: { first_name: 'Adah' },
                  },
                ],
              },
            ],
          },
          {
            correlationId: 'corr-2',
            sourceRunId: runA.id,
            createdOn: expect.any(String),
            inputDetails: { first_name: 'Grace' },
            status: 'to-review',
            decision: null,
            results: [
              {
                id: expect.any(String),
                runId: runA.id,
                createdOn: expect.any(String),
                suggestions: [],
              },
            ],
          },
        ],
      });
    });

    it('orders students by correlation id, results by run and suggestions by ordinal', async () => {
      // A full re-run searches again, and its results are kept alongside.
      // Everything goes in out of order, so only the query's ordering can
      // put it right: the later run reports first, corr-2 before corr-1.
      const runB = await prisma.run.create({
        data: { jobId: jobA.id, kind: 'full', status: 'new' },
      });
      const noMatches = (correlation_id: string) => ({
        correlation_id,
        candidate: { first_name: 'Ada' },
        matches: [],
      });
      await report(runB.id, [noMatches('corr-2'), noMatches('corr-1')]);
      await report(runA.id, [noMatches('corr-1')]);
      // The callback numbers suggestions in the order it stores them, so
      // store them directly, ordinal 1 first.
      const { id: resultId } = await prisma.studentMatchResult.findUniqueOrThrow({
        where: {
          jobId_correlationId_runId: { jobId: jobA.id, correlationId: 'corr-1', runId: runA.id },
        },
      });
      for (const ordinal of [1, 0]) {
        await prisma.studentMatchSuggestion.create({
          data: {
            resultId,
            ordinal,
            studentUniqueId: `SUID-${ordinal}`,
            rosterDetails: {},
            score: 0.5,
          },
        });
      }

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

      const [corr1, corr2] = res.body.students;
      expect([corr1.correlationId, corr2.correlationId]).toEqual(['corr-1', 'corr-2']);
      expect(corr1.results.map((r: { runId: number }) => r.runId)).toEqual([runA.id, runB.id]);
      expect(corr1.results[0].suggestions.map((s: { ordinal: number }) => s.ordinal)).toEqual([
        0, 1,
      ]);
    });

    it('returns no students for a job with no match results', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        counts: { total: 0, toReview: 0, ready: 0, excluded: 0, submitted: 0 },
        students: [],
      });
    });

    describe('with decisions', () => {
      it('returns each student’s status and current decision', async () => {
        await reportStudents(['corr-1', 'corr-2', 'corr-3']);
        const resultId = await resultIdOf('corr-1');
        await decide(cookies, 'corr-1', {
          replacesVersion: null,
          kind: 'match',
          resultId,
          ordinal: 0,
        });
        await decide(cookies, 'corr-2', { replacesVersion: null, kind: 'exclude' });
        await decide(cookies, 'corr-3', { replacesVersion: null, kind: 'exclude' });
        await decide(cookies, 'corr-3', { replacesVersion: 1, kind: 'clear' });

        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

        const decidedBy = expect.objectContaining({ id: userA.id });
        expect(
          res.body.students.map(({ correlationId, status, decision }: Record<string, unknown>) => ({
            correlationId,
            status,
            decision,
          }))
        ).toEqual([
          {
            correlationId: 'corr-1',
            status: 'ready',
            decision: {
              version: 1,
              kind: 'match',
              studentUniqueId: 'SUID-corr-1',
              resultId,
              ordinal: 0,
              search: null,
              decidedBy,
              decidedOn: expect.any(String),
            },
          },
          {
            correlationId: 'corr-2',
            status: 'excluded',
            decision: {
              version: 1,
              kind: 'exclude',
              studentUniqueId: null,
              resultId: null,
              ordinal: null,
              search: null,
              decidedBy,
              decidedOn: expect.any(String),
            },
          },
          { correlationId: 'corr-3', status: 'to-review', decision: null },
        ]);
        expect(res.body.counts).toEqual({
          total: 3,
          toReview: 1,
          ready: 1,
          excluded: 1,
          submitted: 0,
        });
      });

      // A match stays submitted whatever its send run's status.
      it.each(['running', 'success', 'error'] as const)(
        'returns a match in a send run as submitted, with its decision, when the run is %s',
        async (sendRunStatus) => {
          await reportStudents(['corr-1', 'corr-2']);
          for (const correlationId of ['corr-1', 'corr-2']) {
            await decide(cookies, correlationId, {
              replacesVersion: null,
              kind: 'match',
              resultId: await resultIdOf(correlationId),
              ordinal: 0,
            });
          }
          await seedSendRun(jobA.id, ['corr-1'], sendRunStatus);

          const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

          expect(
            res.body.students.map(
              ({ correlationId, status, decision }: GetStudentInputDetailsDto) => ({
                correlationId,
                status,
                version: decision?.version,
              })
            )
          ).toEqual([
            { correlationId: 'corr-1', status: 'submitted', version: 1 },
            { correlationId: 'corr-2', status: 'ready', version: 1 },
          ]);
          expect(res.body.counts).toEqual({
            total: 2,
            toReview: 0,
            ready: 1,
            excluded: 0,
            submitted: 1,
          });
        }
      );

      // A suggestion pick's search is null: see the test above.
      it('returns a match to a student found by searching, with the search and roster details, as ready', async () => {
        await reportStudents(['corr-1', 'corr-2']);
        const search = {
          searchDetails: { first_name: 'Ada', last_name: 'Lovelace', birth_date: '2010-12-10' },
          rosterDetails: { first_name: 'Ada', school_years: [2025], future_field: 'kept' },
        };
        await decide(cookies, 'corr-1', {
          replacesVersion: null,
          kind: 'match',
          studentUniqueId: 'SUID-FOUND',
          search,
        });

        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

        const [student] = res.body.students;
        expect(student.status).toBe('ready');
        expect(student.decision).toEqual({
          version: 1,
          kind: 'match',
          studentUniqueId: 'SUID-FOUND',
          resultId: null,
          ordinal: null,
          search,
          decidedBy: expect.objectContaining({ id: userA.id }),
          decidedOn: expect.any(String),
        });
        expect(res.body.counts).toEqual({
          total: 2,
          toReview: 1,
          ready: 1,
          excluded: 0,
          submitted: 0,
        });
      });

      it('shows no one as the decider once their user is deleted', async () => {
        const goneUser = { email: 'gone@test.com', givenName: 'Gone', familyName: 'User' };
        const { cookies: goneCookies } = await authHelper.login(idpA, goneUser, tenantA);
        await reportStudents(['corr-1']);
        await decide(goneCookies, 'corr-1', {
          replacesVersion: null,
          kind: 'match',
          resultId: await resultIdOf('corr-1'),
          ordinal: 0,
        });
        await prisma.user.deleteMany({ where: { email: goneUser.email } });

        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

        expect(res.body.students[0].status).toBe('ready');
        expect(res.body.students[0].decision.decidedBy).toBeNull();
      });

      it('keeps showing a match to an earlier result after a later run searches again', async () => {
        await reportStudents(['corr-1']);
        const earlierResultId = await resultIdOf('corr-1');
        await decide(cookies, 'corr-1', {
          replacesVersion: null,
          kind: 'match',
          resultId: earlierResultId,
          ordinal: 0,
        });
        const runB = await prisma.run.create({
          data: { jobId: jobA.id, kind: 'full', status: 'new' },
        });
        await reportStudents(['corr-1'], runB.id);

        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

        const [student] = res.body.students;
        expect(student.status).toBe('ready');
        expect(student.decision.resultId).toBe(earlierResultId);
        // Every result is returned, so the page can find the one the match
        // points into.
        expect(student.results.map((r: { id: string }) => r.id)).toEqual([
          earlierResultId,
          await resultIdOf('corr-1', runB.id),
        ]);
      });
    });

    describe('past the review limit', () => {
      let limit: jest.ReplaceProperty<number>;
      beforeEach(() => {
        limit = jest.replaceProperty(app.get(JobsService), 'studentMatchReviewLimit', 2);
      });
      afterEach(() => limit.restore());

      it('returns the counts without the students', async () => {
        await reportStudents(['corr-1', 'corr-2', 'corr-3']);
        await decide(cookies, 'corr-1', { replacesVersion: null, kind: 'exclude' });

        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          counts: { total: 3, toReview: 2, ready: 0, excluded: 1, submitted: 0 },
          students: null,
        });
      });

      it('returns the students up to the limit', async () => {
        await reportStudents(['corr-1', 'corr-2']);

        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

        expect(res.body.counts.total).toBe(2);
        expect(res.body.students).toHaveLength(2);
      });
    });
  });

  describe('access by matching mode', () => {
    const USER = 'runway.test.user';
    const PARTNER_ADMIN = ['runway.test.user', 'runway.test.partneradmin'];
    const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];

    /** A job in this mode with one student reported. Tenant B when `inTenantB`. */
    const seedReportedJob = async (idMatchingMode: IdMatchingMode, inTenantB = false) => {
      const job = await seedJob({
        odsConfig: inTenantB ? odsConfigB2526 : odsConfigA2425,
        bundle: bundleA,
        tenant: inTenantB ? tenantB : tenantA,
        idMatchingMode,
      });
      await report(job.runs[0].id, [
        { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
      ]);
      return job;
    };

    const read = async (jobId: number, tenant: typeof tenantA, roles: string | string[]) => {
      const { cookies } = await authHelper.login(idpA, userA, tenant, roles);
      return request(app.getHttpServer())
        .get(`/jobs/${jobId}/student-match-results`)
        .set('Cookie', [cookies]);
    };

    it('returns ID-based results to any user of the job’s tenant', async () => {
      const job = await seedReportedJob('id_based');

      const res = await read(job.id, tenantA, USER);

      expect(res.status).toBe(200);
      expect(res.body.counts.total).toBe(1);
    });

    describe('in fuzzy background mode', () => {
      it('returns the results to a partner admin', async () => {
        const job = await seedReportedJob('id_based_fuzzy_background');

        const res = await read(job.id, tenantA, PARTNER_ADMIN);

        expect(res.status).toBe(200);
        expect(res.body.counts.total).toBe(1);
      });

      it('refuses a user without an admin role', async () => {
        const job = await seedReportedJob('id_based_fuzzy_background');

        const res = await read(job.id, tenantA, USER);

        expect(res.status).toBe(403);
      });

      it('returns the results to a support user reading across tenants', async () => {
        const job = await seedReportedJob('id_based_fuzzy_background', true);

        const res = await read(job.id, tenantDGlobal, SUPPORT_USER);

        expect(res.status).toBe(200);
        expect(res.body.counts.total).toBe(1);
      });
    });
  });

  describe('the job’s status', () => {
    let cookies: string;
    beforeEach(async () => {
      ({ cookies } = await authHelper.login(idpA, userA, tenantA));
    });

    /** The job as read on its own and in the list, rebuilt as the frontend does: status is computed by the DTO. */
    const readJob = async (jobId: number) => {
      const job = await request(app.getHttpServer()).get(`/jobs/${jobId}`).set('Cookie', [cookies]);
      const list = await request(app.getHttpServer()).get('/jobs').set('Cookie', [cookies]);
      const listed = list.body.find((j: { id: number }) => j.id === jobId);
      return [job.body, listed].map((body) => plainToInstance(GetJobDto, body));
    };

    /** The counts, as the job read and the list each report them. */
    const countsOf = async (jobId: number) =>
      (await readJob(jobId)).map(({ studentMatchCounts }) => {
        const { total, ...statuses } = studentMatchCounts;
        // Every student has exactly one status.
        expect(Object.values(statuses).reduce((sum, count) => sum + count, 0)).toBe(total);
        return studentMatchCounts;
      });

    it('counts each status beside the total', async () => {
      // Two students to review: one undecided, and one whose decision was cleared.
      await reportStudents([
        'corr-undecided',
        'corr-cleared',
        'corr-matched',
        'corr-excluded',
        'corr-submitted',
      ]);
      await decide(cookies, 'corr-cleared', { replacesVersion: null, kind: 'exclude' });
      await decide(cookies, 'corr-cleared', { replacesVersion: 1, kind: 'clear' });
      await decide(cookies, 'corr-matched', {
        replacesVersion: null,
        kind: 'match',
        resultId: await resultIdOf('corr-matched'),
        ordinal: 0,
      });
      await decide(cookies, 'corr-excluded', { replacesVersion: null, kind: 'exclude' });
      await decide(cookies, 'corr-submitted', {
        replacesVersion: null,
        kind: 'match',
        resultId: await resultIdOf('corr-submitted'),
        ordinal: 0,
      });
      await seedSendRun(jobA.id, ['corr-submitted'], 'running');

      expect(await countsOf(jobA.id)).toEqual(
        Array(2).fill({ total: 5, toReview: 2, ready: 1, excluded: 1, submitted: 1 })
      );
    });

    it('shows a fuzzy job whose students are all excluded as success, and won’t resolve it', async () => {
      await prisma.run.update({ where: { id: runA.id }, data: { status: 'success' } });
      await reportStudents(['corr-1', 'corr-2']);
      await decide(cookies, 'corr-1', { replacesVersion: null, kind: 'exclude' });
      await decide(cookies, 'corr-2', { replacesVersion: null, kind: 'exclude' });

      const [onJob, inList] = await readJob(jobA.id);
      const resolved = await request(app.getHttpServer())
        .put(`/jobs/${jobA.id}/resolve`)
        .set('Cookie', [cookies])
        .send({ isResolved: true });

      expect(onJob.status).toBe('success');
      expect(inList.status).toBe('success');
      expect(resolved.status).toBe(400);
    });

    it.each([
      ['to review', async () => undefined],
      // A saved match has delivered nothing yet, so it isn't done.
      [
        'with only a saved match',
        async () => {
          const resultId = await resultIdOf('corr-1');
          await decide(cookies, 'corr-1', {
            replacesVersion: null,
            kind: 'match',
            resultId,
            ordinal: 0,
          });
        },
      ],
      // Its send run is the job's latest run, so it decides the job's status.
      [
        'with only a submitted match, whose send run succeeded',
        async () => {
          const resultId = await resultIdOf('corr-1');
          await decide(cookies, 'corr-1', {
            replacesVersion: null,
            kind: 'match',
            resultId,
            ordinal: 0,
          });
          await seedSendRun(jobA.id, ['corr-1'], 'success');
        },
      ],
    ])('shows a fuzzy job with a student %s as complete with errors', async (_, act) => {
      await prisma.run.update({ where: { id: runA.id }, data: { status: 'success' } });
      await reportStudents(['corr-1', 'corr-2']);
      await decide(cookies, 'corr-2', { replacesVersion: null, kind: 'exclude' });
      await act();

      const [onJob, inList] = await readJob(jobA.id);

      expect(onJob.status).toBe('complete with errors');
      expect(inList.status).toBe('complete with errors');
    });

    it('counts each listed job’s own students', async () => {
      const seedFuzzyJob = () =>
        seedJob({
          odsConfig: odsConfigA2425,
          bundle: bundleA,
          tenant: tenantA,
          idMatchingMode: 'fuzzy',
        });
      const [jobB, jobC] = [await seedFuzzyJob(), await seedFuzzyJob()];
      const runB = jobB.runs[0];
      await reportStudents(['corr-1', 'corr-2']);
      await reportStudents(['corr-1', 'corr-2'], runB.id);
      // The same correlation ids in each job: jobA's corr-1 is matched and
      // corr-2 excluded, and only jobB's corr-1 is submitted.
      await decide(cookies, 'corr-1', {
        replacesVersion: null,
        kind: 'match',
        resultId: await resultIdOf('corr-1'),
        ordinal: 0,
      });
      await decide(cookies, 'corr-2', { replacesVersion: null, kind: 'exclude' });
      await decide(
        cookies,
        'corr-1',
        {
          replacesVersion: null,
          kind: 'match',
          resultId: await resultIdOf('corr-1', runB.id, jobB.id),
          ordinal: 0,
        },
        jobB.id
      );
      await seedSendRun(jobB.id, ['corr-1'], 'running');

      const list = await request(app.getHttpServer()).get('/jobs').set('Cookie', [cookies]);
      const countsIn = (id: number) => {
        const job = list.body.find((j: { id: number }) => j.id === id);
        return job.studentMatchCounts;
      };

      expect([countsIn(jobA.id), countsIn(jobB.id), countsIn(jobC.id)]).toEqual([
        { total: 2, toReview: 0, ready: 1, excluded: 1, submitted: 0 },
        { total: 2, toReview: 1, ready: 0, excluded: 0, submitted: 1 },
        { total: 0, toReview: 0, ready: 0, excluded: 0, submitted: 0 },
      ]);
    });

    it('lets a fuzzy job with students to match be resolved, as complete with errors', async () => {
      // An unresolved job can be resolved only from 'complete with errors'.
      await prisma.run.update({ where: { id: runA.id }, data: { status: 'success' } });
      const resolve = () =>
        request(app.getHttpServer())
          .put(`/jobs/${jobA.id}/resolve`)
          .set('Cookie', [cookies])
          .send({ isResolved: true });

      expect((await resolve()).status).toBe(400);

      await report(runA.id, [
        { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
      ]);

      expect((await resolve()).status).toBe(200);
    });

    it('counts a fuzzy background job’s students but keeps its status', async () => {
      const backgroundJob = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
        idMatchingMode: 'id_based_fuzzy_background',
        runStatus: 'success',
      });
      await report(backgroundJob.runs[0].id, [
        { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
      ]);

      const jobs = await readJob(backgroundJob.id);

      // A student to review, yet still a success: the ID-based run has delivered.
      expect(
        jobs.map(({ studentMatchCounts, status }) => ({
          toReview: studentMatchCounts.toReview,
          status,
        }))
      ).toEqual(Array(2).fill({ toReview: 1, status: 'success' }));
    });
  });
});
