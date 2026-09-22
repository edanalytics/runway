import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import request from 'supertest';
import { seedJob } from '../factories/job-factory';
import { bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigX2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { Job, Run } from '@prisma/client';

/**
 * A student value that must never appear in a response body. Validation errors
 * report indices and field names, never the details under review.
 */
const SENTINEL = 'Sentinel-Never-In-A-Response';

const endpointFor = (runId: number) => `/earthbeam/jobs/${runId}/unmatched-student-records`;

describe('POST /earthbeam/jobs/:runId/unmatched-student-records', () => {
  let jobA: Job;
  let runA: Run;
  let tokenA: string;
  let runX: Run;
  let tokenX: string;

  beforeEach(async () => {
    const authService = app.get(EarthbeamApiAuthService);

    const seededA = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
      idMatchingMode: 'fuzzy',
    });
    jobA = seededA;
    runA = seededA.runs[0];
    tokenA = await authService.createAccessToken({ runId: runA.id });

    const seededX = await seedJob({
      odsConfig: odsConfigX2425,
      bundle: bundleX,
      tenant: tenantX,
      idMatchingMode: 'fuzzy',
    });
    runX = seededX.runs[0];
    tokenX = await authService.createAccessToken({ runId: runX.id });
  });

  const post = (runId: number, token: string, body: unknown) =>
    request(app.getHttpServer())
      .post(endpointFor(runId))
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  describe('ingestion', () => {
    it('persists input details, one result per group, and ordered suggestions', async () => {
      const res = await post(runA.id, tokenA, [
        {
          correlation_id: 'corr-multi',
          candidate: {
            first_name: 'Ada',
            last_name: 'Lovelace',
            // Deliberately not a real date: malformed input may be exactly why
            // this record needs review, so it must survive verbatim.
            birth_date: '1815-13-45',
            school_ids: [12, 34],
            student_ids: ['local-1', 'local-2'],
          },
          matches: [
            {
              score: 0.97,
              student_unique_id: 'SUID-1',
              first_name: 'Ada',
              middle_name: null,
              last_name: 'Lovelace',
              birth_date: '1815-12-10',
              student_ids: [{ id_type: 'state', id_value: 'ST-1' }],
              school_years: [2024, 2025],
            },
            {
              score: 0.42,
              student_unique_id: 'SUID-2',
              first_name: 'Adah',
              middle_name: 'Byron',
              last_name: 'Lovelace',
              birth_date: '1815-12-10',
              student_ids: [],
              school_years: [2025],
            },
          ],
        },
        {
          correlation_id: 'corr-empty',
          candidate: { first_name: 'Grace', last_name: 'Hopper' },
          matches: [],
        },
      ]);

      expect(res.status).toBe(200);

      const inputs = await prisma.studentInputDetails.findMany({
        where: { jobId: jobA.id },
        orderBy: { correlationId: 'asc' },
      });
      expect(inputs).toHaveLength(2);
      expect(inputs.map((i) => i.correlationId)).toEqual(['corr-empty', 'corr-multi']);
      // Provenance comes from the authenticated run, never the body.
      expect(inputs.every((i) => i.sourceRunId === runA.id)).toBe(true);
      expect(inputs.find((i) => i.correlationId === 'corr-multi')?.inputDetails).toEqual({
        first_name: 'Ada',
        last_name: 'Lovelace',
        birth_date: '1815-13-45',
        school_ids: [12, 34],
        student_ids: ['local-1', 'local-2'],
      });

      const results = await prisma.studentMatchResult.findMany({
        where: { jobId: jobA.id },
        orderBy: { correlationId: 'asc' },
        include: { studentMatchSuggestion: { orderBy: { ordinal: 'asc' } } },
      });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.runId === runA.id)).toBe(true);

      // A result exists even with no suggestions: "searched, found nothing" is
      // not the same as "never searched".
      const empty = results.find((r) => r.correlationId === 'corr-empty');
      expect(empty?.studentMatchSuggestion).toHaveLength(0);

      const multi = results.find((r) => r.correlationId === 'corr-multi');
      expect(
        multi?.studentMatchSuggestion.map((s) => ({
          ordinal: s.ordinal,
          studentUniqueId: s.studentUniqueId,
          score: s.score.toString(),
        }))
      ).toEqual([
        { ordinal: 0, studentUniqueId: 'SUID-1', score: '0.97' },
        { ordinal: 1, studentUniqueId: 'SUID-2', score: '0.42' },
      ]);
      expect(multi?.studentMatchSuggestion[0].rosterDetails).toEqual({
        first_name: 'Ada',
        middle_name: null,
        last_name: 'Lovelace',
        birth_date: '1815-12-10',
        student_ids: [{ id_type: 'state', id_value: 'ST-1' }],
        school_years: [2024, 2025],
      });
    });

    it('accepts an empty batch without writing rows', async () => {
      const res = await post(runA.id, tokenA, []);

      expect(res.status).toBe(200);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(0);
    });

    it('discards unrecognized keys, including nested correlation ids', async () => {
      const res = await post(runA.id, tokenA, [
        {
          correlation_id: 'corr-unknown-keys',
          candidate: {
            first_name: 'Ada',
            // Recognized fields absent from the input stay absent — missing is
            // not the same as null on the candidate side.
            correlation_id: 'nested-should-be-dropped',
            unexpected: 'drop me',
          },
          matches: [
            {
              score: 1,
              student_unique_id: 'SUID-1',
              first_name: 'Ada',
              correlation_id: 'nested-should-be-dropped',
              unexpected: 'drop me',
              student_ids: [{ id_type: 'state', id_value: 'ST-1', unexpected: 'drop me' }],
            },
          ],
        },
      ]);

      expect(res.status).toBe(200);

      const input = await prisma.studentInputDetails.findUniqueOrThrow({
        where: { jobId_correlationId: { jobId: jobA.id, correlationId: 'corr-unknown-keys' } },
      });
      expect(input.inputDetails).toEqual({ first_name: 'Ada' });

      const suggestion = await prisma.studentMatchSuggestion.findFirstOrThrow({
        where: { studentMatchResult: { jobId: jobA.id, correlationId: 'corr-unknown-keys' } },
      });
      // Missing roster fields normalize to null; IDRS gives absence no distinct
      // meaning on the roster side.
      expect(suggestion.rosterDetails).toEqual({
        first_name: 'Ada',
        middle_name: null,
        last_name: null,
        birth_date: null,
        student_ids: [{ id_type: 'state', id_value: 'ST-1' }],
        school_years: null,
      });
    });
  });

  describe('validation', () => {
    const candidate = { first_name: SENTINEL };
    const match = { score: 1, student_unique_id: 'SUID-1' };

    it.each([
      ['a top-level object instead of an array', { correlation_id: 'c', candidate, matches: [] }],
      ['a top-level string', JSON.stringify([])],
      ['a null candidate', [{ correlation_id: 'c', candidate: null, matches: [] }]],
      ['an array candidate', [{ correlation_id: 'c', candidate: [], matches: [] }]],
      ['a missing candidate', [{ correlation_id: 'c', matches: [] }]],
      ['non-array matches', [{ correlation_id: 'c', candidate, matches: {} }]],
      ['a primitive match', [{ correlation_id: 'c', candidate, matches: ['nope'] }]],
      ['a missing correlation id', [{ candidate, matches: [match] }]],
      ['an empty correlation id', [{ correlation_id: '', candidate, matches: [match] }]],
      [
        'a missing student id',
        [{ correlation_id: 'c', candidate, matches: [{ score: 1 }] }],
      ],
      [
        'an empty student id',
        [{ correlation_id: 'c', candidate, matches: [{ score: 1, student_unique_id: '' }] }],
      ],
      [
        'a nonnumeric score',
        [
          {
            correlation_id: 'c',
            candidate,
            matches: [{ score: 'high', student_unique_id: 'SUID-1' }],
          },
        ],
      ],
      [
        'duplicate correlation ids in one request',
        [
          { correlation_id: 'dupe', candidate, matches: [] },
          { correlation_id: 'dupe', candidate, matches: [] },
        ],
      ],
    ])('rejects %s with 400 and writes nothing', async (_label, body) => {
      const res = await post(runA.id, tokenA, body);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(SENTINEL);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
    });

    it('accepts a 128-character correlation id and rejects 129 characters', async () => {
      // Multibyte on purpose: PostgreSQL's length() counts characters, so the
      // boundary must be measured in code points, not UTF-16 units or bytes.
      const at = (n: number) => 'é'.repeat(n);

      const ok = await post(runA.id, tokenA, [
        { correlation_id: at(128), candidate: { first_name: 'Ada' }, matches: [] },
      ]);
      expect(ok.status).toBe(200);

      const tooLong = await post(runA.id, tokenA, [
        { correlation_id: at(129), candidate: { first_name: 'Ada' }, matches: [] },
      ]);
      expect(tooLong.status).toBe(400);

      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(1);
    });
  });

  describe('authentication', () => {
    it('rejects an unauthenticated request without writing rows', async () => {
      const res = await request(app.getHttpServer())
        .post(endpointFor(runA.id))
        .send([{ correlation_id: 'c', candidate: { first_name: 'Ada' }, matches: [] }]);

      expect(res.status).toBe(401);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
    });

    it("rejects a token issued for another run without writing rows", async () => {
      const res = await post(runA.id, tokenX, [
        { correlation_id: 'c', candidate: { first_name: 'Ada' }, matches: [] },
      ]);

      expect(res.status).toBe(403);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(await prisma.studentInputDetails.count({ where: { jobId: runX.jobId } })).toBe(0);
    });
  });
});

describe('POST /earthbeam/jobs/:runId/unmatched-student-records — retries and history', () => {
  let jobA: Job;
  let runA: Run;
  let tokenA: string;

  const candidate = {
    first_name: 'Ada',
    last_name: 'Lovelace',
    birth_date: '1815-12-10',
    student_ids: ['local-1'],
  };
  const match = {
    score: 0.97,
    student_unique_id: 'SUID-1',
    first_name: 'Ada',
    middle_name: null,
    last_name: 'Lovelace',
    birth_date: '1815-12-10',
    student_ids: [{ id_type: 'state', id_value: 'ST-1' }],
    school_years: [2025],
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
    tokenA = await app.get(EarthbeamApiAuthService).createAccessToken({ runId: runA.id });
  });

  const post = (runId: number, token: string, body: unknown) =>
    request(app.getHttpServer())
      .post(endpointFor(runId))
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const record = (overrides: Record<string, unknown> = {}) => ({
    correlation_id: 'corr-1',
    candidate,
    matches: [match],
    ...overrides,
  });

  const snapshot = async () => {
    const inputs = await prisma.studentInputDetails.findMany({ where: { jobId: jobA.id } });
    const results = await prisma.studentMatchResult.findMany({
      where: { jobId: jobA.id },
      include: { studentMatchSuggestion: { orderBy: { ordinal: 'asc' } } },
    });
    return { inputs, results };
  };

  it('treats a rebatched, reordered, case-variant retry as a no-op', async () => {
    const first = await post(runA.id, tokenA, [
      record(),
      { correlation_id: 'corr-2', candidate: { first_name: 'Grace' }, matches: [] },
    ]);
    expect(first.status).toBe(200);
    const before = await snapshot();

    // Same content, but: split across two requests, object keys in a different
    // order, candidate details in different case, and a roster field that was
    // explicitly null now simply absent.
    const retryA = await post(runA.id, tokenA, [
      {
        matches: [
          {
            student_unique_id: 'SUID-1',
            school_years: [2025],
            score: 0.97,
            last_name: 'Lovelace',
            first_name: 'Ada',
            birth_date: '1815-12-10',
            student_ids: [{ id_value: 'ST-1', id_type: 'state' }],
          },
        ],
        candidate: {
          last_name: 'LOVELACE',
          first_name: 'ADA',
          student_ids: ['LOCAL-1'],
          birth_date: '1815-12-10',
        },
        correlation_id: 'corr-1',
      },
    ]);
    expect(retryA.status).toBe(200);

    const retryB = await post(runA.id, tokenA, [
      { correlation_id: 'corr-2', candidate: { first_name: 'Grace' }, matches: [] },
    ]);
    expect(retryB.status).toBe(200);

    const after = await snapshot();
    expect(after.inputs).toHaveLength(2);
    expect(after.results).toHaveLength(2);
    // Nothing was rewritten: ids, timestamps and the first accepted spelling
    // all survive the retry.
    expect(after.inputs).toEqual(before.inputs);
    expect(after.results).toEqual(before.results);
    expect(
      after.inputs.find((i) => i.correlationId === 'corr-1')?.inputDetails
    ).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace', student_ids: ['local-1'] });
  });

  it.each([
    [
      'input details that differ beyond case',
      [record({ candidate: { ...candidate, first_name: 'Adelaide' } })],
    ],
    ['a changed score', [record({ matches: [{ ...match, score: 0.5 }] })]],
    [
      'changed roster details',
      [record({ matches: [{ ...match, middle_name: 'Byron' }] })],
    ],
    [
      'a changed suggestion count',
      [record({ matches: [match, { ...match, student_unique_id: 'SUID-2' }] })],
    ],
    [
      'reordered suggestions',
      [
        {
          correlation_id: 'corr-1',
          candidate,
          matches: [{ ...match, student_unique_id: 'SUID-0' }, match],
        },
      ],
    ],
    ['an emptied suggestion set', [record({ matches: [] })]],
  ])('rejects %s with 409 and rolls the whole batch back', async (_label, conflicting) => {
    const first = await post(runA.id, tokenA, [record()]);
    expect(first.status).toBe(200);
    const before = await snapshot();

    // The conflicting group travels with a brand-new one, which must not
    // survive either.
    const res = await post(runA.id, tokenA, [
      ...(conflicting as object[]),
      { correlation_id: 'corr-new', candidate: { first_name: 'Grace' }, matches: [] },
    ]);

    expect(res.status).toBe(409);
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.inputs.some((i) => i.correlationId === 'corr-new')).toBe(false);
  });

  // Input details are extracted only on a job's first run, so a later run
  // re-sends candidates that already exist and adds only its own result.
  it('records a later run as new history rather than a conflict', async () => {
    expect((await post(runA.id, tokenA, [record()])).status).toBe(200);
    const before = await snapshot();

    const runB = await prisma.run.create({ data: { jobId: jobA.id, status: 'new' } });
    const tokenB = await app.get(EarthbeamApiAuthService).createAccessToken({ runId: runB.id });

    // Same input, different suggestions: a new search, not a disagreement.
    const res = await post(runB.id, tokenB, [
      record({ matches: [{ ...match, score: 0.1, student_unique_id: 'SUID-9' }] }),
    ]);
    expect(res.status).toBe(200);

    const after = await snapshot();
    expect(after.inputs).toHaveLength(1);
    // The input row keeps the run that first established it.
    expect(after.inputs[0].sourceRunId).toBe(runA.id);
    expect(after.inputs[0].createdOn).toEqual(before.inputs[0].createdOn);

    expect(after.results).toHaveLength(2);
    expect(after.results.find((r) => r.runId === runA.id)).toEqual(before.results[0]);
    expect(
      after.results.find((r) => r.runId === runB.id)?.studentMatchSuggestion.map((s) => s.studentUniqueId)
    ).toEqual(['SUID-9']);
  });

  it('keeps another tenant’s identical ids in a separate graph', async () => {
    const seededX = await seedJob({
      odsConfig: odsConfigX2425,
      bundle: bundleX,
      tenant: tenantX,
      idMatchingMode: 'fuzzy',
    });
    const runX = seededX.runs[0];
    const tokenX = await app.get(EarthbeamApiAuthService).createAccessToken({ runId: runX.id });

    expect((await post(runA.id, tokenA, [record()])).status).toBe(200);
    // Same correlation id, same canonical student id, different tenant: a
    // canonical id is only unique within its partner/tenant scope.
    expect((await post(runX.id, tokenX, [record()])).status).toBe(200);

    expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(1);
    expect(await prisma.studentInputDetails.count({ where: { jobId: seededX.id } })).toBe(1);
    expect(await prisma.studentMatchResult.count({ where: { jobId: seededX.id } })).toBe(1);
  });

  describe('schema-level ownership', () => {
    // These assert the composite foreign keys directly, independently of the
    // endpoint, since they are the last defence if ownership is ever derived
    // from something other than the authenticated run.
    it('refuses an input row whose source run belongs to another job', async () => {
      const otherJob = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });
      const foreignRun = otherJob.runs[0];

      await expect(
        prisma.$executeRaw`
          INSERT INTO public.student_input_details
            (job_id, correlation_id, source_run_id, input_details)
          VALUES (${jobA.id}, 'corr-bad', ${foreignRun.id}, '{}'::jsonb)
        `
      ).rejects.toThrow();
    });

    it('refuses a result row whose run belongs to another job', async () => {
      const otherJob = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });
      const foreignRun = otherJob.runs[0];
      expect((await post(runA.id, tokenA, [record()])).status).toBe(200);

      await expect(
        prisma.$executeRaw`
          INSERT INTO public.student_match_result (job_id, correlation_id, run_id)
          VALUES (${jobA.id}, 'corr-1', ${foreignRun.id})
        `
      ).rejects.toThrow();
    });
  });
});
