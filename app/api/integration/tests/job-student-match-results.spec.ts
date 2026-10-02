import request from 'supertest';
import { IdMatchingMode, Job, Run } from '@prisma/client';
import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigB2526 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantB, tenantDGlobal } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB } from '../fixtures/user-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { GetJobDto } from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { JobsService } from 'api/src/jobs/jobs.service';

describe('GET /jobs/:jobId/student-match-results', () => {
  let jobA: Job;
  let runA: Run;
  let endpoint: string;

  /** Report match results for a run the way the Executor does. */
  const report = async (runId: number, body: unknown[]) => {
    const token = await app.get(EarthbeamApiAuthService).createAccessToken({ runId });
    const res = await request(app.getHttpServer())
      .post(`/earthbeam/jobs/${runId}/student-match-results`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
  };

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

  describe('authentication', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get(endpoint);

      expect(res.status).toBe(401);
    });

    it('rejects a user from another tenant', async () => {
      const { cookies } = await authHelper.login(idpA, userB, tenantB);

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

      expect(res.status).toBe(403);
    });
  });

  describe('for the job’s tenant', () => {
    let cookies: string;
    beforeEach(async () => {
      ({ cookies } = await authHelper.login(idpA, userA, tenantA));
    });

    it('returns each student with every run’s result and its suggestions', async () => {
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
      const runB = await prisma.run.create({ data: { jobId: jobA.id, status: 'new' } });
      await report(runB.id, [
        {
          correlation_id: 'corr-1',
          candidate: { first_name: 'Ada', last_name: 'Lovelace' },
          matches: [{ student_unique_id: 'SUID-9', score: 0.5, first_name: 'Ada' }],
        },
      ]);

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        count: 2,
        students: [
          {
            correlationId: 'corr-1',
            sourceRunId: runA.id,
            createdOn: expect.any(String),
            inputDetails: { first_name: 'Ada', last_name: 'Lovelace' },
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
              {
                id: expect.any(String),
                runId: runB.id,
                createdOn: expect.any(String),
                suggestions: [
                  {
                    ordinal: 0,
                    studentUniqueId: 'SUID-9',
                    score: 0.5,
                    rosterDetails: { first_name: 'Ada' },
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
      // Everything goes in out of order, so only the query's ordering can
      // put it right: the later run reports first, corr-2 before corr-1.
      const runB = await prisma.run.create({ data: { jobId: jobA.id, status: 'new' } });
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
      expect(res.body).toEqual({ count: 0, students: [] });
    });

    describe('past the review limit', () => {
      let limit: jest.ReplaceProperty<number>;
      beforeEach(() => {
        limit = jest.replaceProperty(app.get(JobsService), 'studentMatchReviewLimit', 2);
      });
      afterEach(() => limit.restore());

      it('returns the count without the students', async () => {
        await report(
          runA.id,
          ['corr-1', 'corr-2', 'corr-3'].map((correlation_id) => ({
            correlation_id,
            candidate: { first_name: 'Ada' },
            matches: [],
          }))
        );

        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ count: 3, students: null });
      });

      it('returns the students up to the limit', async () => {
        await report(
          runA.id,
          ['corr-1', 'corr-2'].map((correlation_id) => ({
            correlation_id,
            candidate: { first_name: 'Ada' },
            matches: [],
          }))
        );

        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

        expect(res.body.count).toBe(2);
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
      expect(res.body.count).toBe(1);
    });

    describe('in fuzzy background mode', () => {
      it('returns the results to a partner admin', async () => {
        const job = await seedReportedJob('id_based_fuzzy_background');

        const res = await read(job.id, tenantA, PARTNER_ADMIN);

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
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
        expect(res.body.count).toBe(1);
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

    it('shows a fuzzy job with students to match as complete with errors', async () => {
      await prisma.run.update({ where: { id: runA.id }, data: { status: 'success' } });
      await report(runA.id, [
        { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
      ]);

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
      await report(runA.id, [
        { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
        { correlation_id: 'corr-2', candidate: { first_name: 'Grace' }, matches: [] },
      ]);
      await report(jobB.runs[0].id, [
        { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
      ]);

      const list = await request(app.getHttpServer()).get('/jobs').set('Cookie', [cookies]);
      const countOf = (id: number) =>
        list.body.find((j: { id: number }) => j.id === id).studentsToMatchCount;

      expect([countOf(jobA.id), countOf(jobB.id), countOf(jobC.id)]).toEqual([2, 1, 0]);
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

      const [onJob, inList] = await readJob(backgroundJob.id);

      expect(onJob.studentsToMatchCount).toBe(1);
      expect(inList.studentsToMatchCount).toBe(1);
      expect(onJob.status).toBe('success');
      expect(inList.status).toBe('success');
    });
  });
});
