import request from 'supertest';
import { Job, Run } from '@prisma/client';
import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigB2526 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantB } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB } from '../fixtures/user-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';

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
    const seeded = await seedJob({ odsConfig: odsConfigA2425, bundle: bundleA, tenant: tenantA });
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

    it('returns each group with every run’s result and its suggestions in order', async () => {
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
      expect(res.body).toEqual([
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
      ]);
    });

    it('returns an empty list for a job with no match results', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
