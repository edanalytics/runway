import request from 'supertest';
import { Job, Run } from '@prisma/client';
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
      await seedJob({ odsConfig: odsConfigB2526, bundle: bundleA, tenant: tenantB });
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

    it('returns each student with every run’s result and its suggestions in order', async () => {
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

    it('returns no students for a job with no match results', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 0, students: [] });
    });

    describe('past the review limit', () => {
      // So many students to match means something is wrong with the file,
      // not a queue anyone will review, so only the count comes back.
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

  describe('in fuzzy background mode', () => {
    // Background mode exists for admins to check suggestions before a partner
    // switches to fuzzy, so its results are theirs alone.
    const USER = 'runway.test.user';
    const PARTNER_ADMIN = ['runway.test.user', 'runway.test.partneradmin'];
    const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];

    const seedBackgroundJob = async (
      tenant: typeof tenantA | typeof tenantB,
      odsConfig: typeof odsConfigA2425 | typeof odsConfigB2526
    ) => {
      const job = await seedJob({
        odsConfig,
        bundle: bundleA,
        tenant,
        idMatchingMode: 'id_based_fuzzy_background',
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

    it.each([
      { role: 'a partner admin', roles: PARTNER_ADMIN },
      { role: 'a support user', roles: SUPPORT_USER },
    ])('returns the results to $role', async ({ roles }) => {
      const job = await seedBackgroundJob(tenantA, odsConfigA2425);

      const res = await read(job.id, tenantA, roles);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.students).toHaveLength(1);
    });

    it('refuses a user without an admin role', async () => {
      const job = await seedBackgroundJob(tenantA, odsConfigA2425);

      const res = await read(job.id, tenantA, USER);

      expect(res.status).toBe(403);
      expect(res.body.students).toBeUndefined();
    });

    it('returns the results to a support user reading across tenants', async () => {
      const job = await seedBackgroundJob(tenantB, odsConfigB2526);

      const res = await read(job.id, tenantDGlobal, SUPPORT_USER);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });
  });

  describe('the job’s status', () => {
    let cookies: string;
    beforeEach(async () => {
      ({ cookies } = await authHelper.login(idpA, userA, tenantA));
    });

    it('counts the students awaiting a match on the job and in the job list', async () => {
      await report(runA.id, [
        { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
        { correlation_id: 'corr-2', candidate: { first_name: 'Grace' }, matches: [] },
      ]);

      const job = await request(app.getHttpServer())
        .get(`/jobs/${jobA.id}`)
        .set('Cookie', [cookies]);
      const list = await request(app.getHttpServer()).get('/jobs').set('Cookie', [cookies]);

      expect(job.body.studentsToMatchCount).toBe(2);
      expect(list.body.find((j: { id: number }) => j.id === jobA.id).studentsToMatchCount).toBe(2);
    });

    it('counts none for a job with no match results', async () => {
      const job = await request(app.getHttpServer())
        .get(`/jobs/${jobA.id}`)
        .set('Cookie', [cookies]);

      expect(job.body.studentsToMatchCount).toBe(0);
    });

    it('lets a successful run with students to match be resolved, as complete with errors', async () => {
      // Resolving is allowed only from 'complete with errors'.
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

    it('carries the job’s matching mode', async () => {
      const job = await request(app.getHttpServer())
        .get(`/jobs/${jobA.id}`)
        .set('Cookie', [cookies]);

      expect(job.body.idMatchingMode).toBe('fuzzy');
    });

    describe('in fuzzy background mode', () => {
      // The ID-based run already delivered, and review is read-only, so
      // students to match say nothing about the job's outcome.
      let backgroundJob: Awaited<ReturnType<typeof seedJob>>;
      beforeEach(async () => {
        backgroundJob = await seedJob({
          odsConfig: odsConfigA2425,
          bundle: bundleA,
          tenant: tenantA,
          idMatchingMode: 'id_based_fuzzy_background',
          runStatus: 'success',
        });
        await report(backgroundJob.runs[0].id, [
          { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
        ]);
      });

      it('counts the students but keeps the job’s status', async () => {
        const job = await request(app.getHttpServer())
          .get(`/jobs/${backgroundJob.id}`)
          .set('Cookie', [cookies]);
        const list = await request(app.getHttpServer()).get('/jobs').set('Cookie', [cookies]);
        const listed = list.body.find((j: { id: number }) => j.id === backgroundJob.id);

        // Status is computed by the DTO, so rebuild it as the frontend does.
        const [onJob, inList] = [job.body, listed].map((body) => plainToInstance(GetJobDto, body));

        expect(onJob.studentsToMatchCount).toBe(1);
        expect(inList.studentsToMatchCount).toBe(1);
        expect(onJob.status).toBe('success');
        expect(inList.status).toBe('success');
      });

      it('doesn’t let the job be resolved over them', async () => {
        const res = await request(app.getHttpServer())
          .put(`/jobs/${backgroundJob.id}/resolve`)
          .set('Cookie', [cookies])
          .send({ isResolved: true });

        expect(res.status).toBe(400);
      });
    });
  });
});
