import request from 'supertest';
import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import { SendRunService } from 'api/src/earthbeam/executor/send-run.service';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA } from '../fixtures/user-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { reportMatchResults } from '../helpers/report-match-results';

// SPIKE: the submit rough cut's happy path and its conflict, no more.
describe('POST /jobs/:jobId/student-match-batches', () => {
  let job: Awaited<ReturnType<typeof seedJob>>;
  let cookies: string;
  let startSendRun: jest.SpyInstance;

  const submit = (students: { correlationId: string; version: number }[]) =>
    request(app.getHttpServer())
      .post(`/jobs/${job.id}/student-match-batches`)
      .set('Cookie', [cookies])
      .send({ students });

  /** Saves a match to the student's first suggestion, and returns its version. */
  const matchFirst = async (correlationId: string) => {
    const { id } = await prisma.studentMatchResult.findUniqueOrThrow({
      where: {
        jobId_correlationId_runId: { jobId: job.id, correlationId, runId: job.runs[0].id },
      },
    });
    const res = await request(app.getHttpServer())
      .post(`/jobs/${job.id}/student-match-results/${correlationId}/decisions`)
      .set('Cookie', [cookies])
      .send({ replacesVersion: null, kind: 'match', resultId: id.toString(), ordinal: 0 });
    expect(res.status).toBe(201);
    return res.body.decision.version as number;
  };

  beforeEach(async () => {
    // A fuzzy job whose first run succeeded and posted three students.
    job = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
      idMatchingMode: 'fuzzy',
      runStatus: 'success',
    });
    await reportMatchResults(
      job.runs[0].id,
      ['corr-1', 'corr-2', 'corr-3'].map((correlationId, i) => ({
        correlation_id: correlationId,
        candidate: { first_name: `Student ${i}` },
        matches: [{ student_unique_id: `SUID-${i + 1}`, score: 0.9 }],
      }))
    );
    ({ cookies } = await authHelper.login(idpA, userA, tenantA));
    startSendRun = jest.spyOn(app.get(SendRunService), 'startSendRun');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('submits ready students as a batch and starts its send run', async () => {
    const v1 = await matchFirst('corr-1');
    const v2 = await matchFirst('corr-2');

    const res = await submit([
      { correlationId: 'corr-1', version: v1 },
      { correlationId: 'corr-2', version: v2 },
    ]);

    expect(res.status).toBe(201);
    const { batch } = res.body;
    expect(batch).toEqual({
      id: expect.any(Number),
      runId: expect.any(Number),
      submittedBy: expect.objectContaining({ id: userA.id }),
      submittedOn: expect.any(String),
      memberCount: 2,
    });
    // The batch references exactly the decision rows it submitted.
    expect(
      await prisma.studentMatchBatchMember.findMany({
        where: { batchId: batch.id },
        orderBy: { correlationId: 'asc' },
        select: { correlationId: true, seq: true },
      })
    ).toEqual([
      { correlationId: 'corr-1', seq: v1 },
      { correlationId: 'corr-2', seq: v2 },
    ]);
    expect(startSendRun).toHaveBeenCalledTimes(1);
    expect(startSendRun.mock.calls[0][0]).toMatchObject({ id: batch.runId, jobId: job.id });
    expect(startSendRun.mock.calls[0][1]).toEqual({ id: batch.id, memberCount: 2 });

    // Submitted students read as reprocessing; the rest are untouched.
    const results = await request(app.getHttpServer())
      .get(`/jobs/${job.id}/student-match-results`)
      .set('Cookie', [cookies]);
    expect(results.body.counts).toEqual({
      total: 3,
      toReview: 1,
      ready: 0,
      excluded: 0,
      reprocessing: 2,
    });
    expect(
      results.body.students.map(({ correlationId, status }: Record<string, string>) => [
        correlationId,
        status,
      ])
    ).toEqual([
      ['corr-1', 'reprocessing'],
      ['corr-2', 'reprocessing'],
      ['corr-3', 'to-review'],
    ]);

    const batches = await request(app.getHttpServer())
      .get(`/jobs/${job.id}/student-match-batches`)
      .set('Cookie', [cookies]);
    expect(batches.status).toBe(200);
    expect(batches.body).toEqual({ batches: [batch] });

    // The send run's payload names its batch's students (the assumed contract).
    const token = await app
      .get(EarthbeamApiAuthService)
      .createAccessToken({ runId: batch.runId });
    const payload = await request(app.getHttpServer())
      .get(`/earthbeam/jobs/${batch.runId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(payload.status).toBe(200);
    expect(payload.body.runType).toBe('send');
    expect(payload.body.send).toEqual({
      batchId: batch.id,
      sourceRunId: job.runs[0].id,
      students: [
        { correlationId: 'corr-1', studentUniqueId: 'SUID-1' },
        { correlationId: 'corr-2', studentUniqueId: 'SUID-2' },
      ],
    });
    expect(payload.body.appUrls.identityService).toBeUndefined();
    expect(payload.body.appUrls.studentMatchResults).toBeUndefined();
  });

  it('submits nothing when a version is stale', async () => {
    const v1 = await matchFirst('corr-1');
    const stale = await matchFirst('corr-2');
    // Another reviewer clears corr-2 after the page loaded it.
    const cleared = await request(app.getHttpServer())
      .post(`/jobs/${job.id}/student-match-results/corr-2/decisions`)
      .set('Cookie', [cookies])
      .send({ replacesVersion: stale, kind: 'clear' });
    expect(cleared.status).toBe(201);

    const res = await submit([
      { correlationId: 'corr-1', version: v1 },
      { correlationId: 'corr-2', version: stale },
    ]);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      statusCode: 409,
      code: 'decision_changed',
      message: 'A student’s decision has changed since the page loaded.',
    });
    expect(await prisma.studentMatchBatch.count({ where: { jobId: job.id } })).toBe(0);
    expect(await prisma.run.count({ where: { jobId: job.id } })).toBe(1);
    expect(startSendRun).not.toHaveBeenCalled();
  });
});
