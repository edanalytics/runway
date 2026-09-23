import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import request from 'supertest';
import { seedJob } from '../factories/job-factory';
import { bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigX2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { Job, Run } from '@prisma/client';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { Logger } from '@nestjs/common';

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

    it('stores what the Executor sends, including keys the app does not read yet', async () => {
      const candidate = {
        first_name: 'Ada',
        correlation_id: 'nested',
        added_by_idrs_later: 'kept',
      };
      const res = await post(runA.id, tokenA, [
        {
          correlation_id: 'corr-as-sent',
          candidate,
          matches: [
            {
              score: 1,
              student_unique_id: 'SUID-1',
              first_name: 'Ada',
              added_by_idrs_later: 'kept',
              student_ids: ['bare-string', { id_type: 'state', extra: 'kept' }],
            },
          ],
        },
      ]);

      expect(res.status).toBe(200);

      const input = await prisma.studentInputDetails.findUniqueOrThrow({
        where: { jobId_correlationId: { jobId: jobA.id, correlationId: 'corr-as-sent' } },
      });
      expect(input.inputDetails).toEqual(candidate);

      const suggestion = await prisma.studentMatchSuggestion.findFirstOrThrow({
        where: { studentMatchResult: { jobId: jobA.id, correlationId: 'corr-as-sent' } },
      });
      // The match as sent, minus the two fields stored as columns. Fields the
      // match omitted stay omitted.
      expect(suggestion.rosterDetails).toEqual({
        first_name: 'Ada',
        added_by_idrs_later: 'kept',
        student_ids: ['bare-string', { id_type: 'state', extra: 'kept' }],
      });
    });
  });

  // Rejected payloads must leave nothing written and quote no student value
  // back, in the response or the log — a database constraint violation's
  // detail quotes the failing row.
  describe('rejected payloads', () => {
    const candidate = { first_name: SENTINEL };
    const match = { score: 1, student_unique_id: 'SUID-1' };
    let logs: string[];
    let logSpies: jest.SpyInstance[];

    beforeEach(() => {
      logs = [];
      const capture = (message: unknown) => {
        logs.push(String(message));
      };
      logSpies = [
        jest.spyOn(Logger.prototype, 'log').mockImplementation(capture),
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture),
        jest.spyOn(Logger.prototype, 'error').mockImplementation(capture),
      ];
    });
    afterEach(() => logSpies.forEach((spy) => spy.mockRestore()));

    const expectNothingWrittenOrLeaked = async (res: request.Response) => {
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain(SENTINEL);
      expect(logs.join('\n')).not.toContain(SENTINEL);
    };

    it.each([
      ['a top-level object instead of an array', { correlation_id: 'c', candidate, matches: [] }],
      ['a primitive record', [5]],
      ['a null record', [null]],
      ['a missing correlation id', [{ candidate, matches: [match] }]],
      ['an empty correlation id', [{ correlation_id: '', candidate, matches: [match] }]],
      ['a null candidate', [{ correlation_id: 'c', candidate: null, matches: [] }]],
      ['an array candidate', [{ correlation_id: 'c', candidate: [], matches: [] }]],
      ['a missing candidate', [{ correlation_id: 'c', matches: [] }]],
      // Without a check, these two would be stored as "IDRS found nothing".
      ['missing matches', [{ correlation_id: 'c', candidate }]],
      ['null matches', [{ correlation_id: 'c', candidate, matches: null }]],
      ['non-array matches', [{ correlation_id: 'c', candidate, matches: {} }]],
      ['a primitive match', [{ correlation_id: 'c', candidate, matches: ['nope'] }]],
      ['a missing student id', [{ correlation_id: 'c', candidate, matches: [{ score: 1 }] }]],
      [
        'an empty student id',
        [{ correlation_id: 'c', candidate, matches: [{ score: 1, student_unique_id: '' }] }],
      ],
      [
        'a nonnumeric score',
        [{ correlation_id: 'c', candidate, matches: [{ score: 'high', student_unique_id: 'S' }] }],
      ],
    ])('rejects %s with 400', async (_label, body) => {
      const res = await post(runA.id, tokenA, body);

      expect(res.status).toBe(400);
      await expectNothingWrittenOrLeaked(res);
      expect(logs.join('\n')).toContain('rejected payload');
    });

    // Duplicates span records, which a per-record DTO cannot see, and need no
    // check of their own: they collapse to one input and one result, and two
    // non-empty match lists both claim ordinal 0 under it and violate the
    // suggestion primary key, so they can never mix.
    it('lets the database refuse two records that share a correlation id', async () => {
      const res = await post(runA.id, tokenA, [
        { correlation_id: 'dupe', candidate, matches: [match] },
        { correlation_id: 'dupe', candidate, matches: [match] },
      ]);

      expect(res.status).toBe(500);
      await expectNothingWrittenOrLeaked(res);
      // 23505: unique_violation. The SQLSTATE is logged as the diagnosis.
      expect(logs.join('\n')).toContain('sqlstate=23505');
    });

    // Sent explicitly as JSON: superagent defaults a string body to
    // x-www-form-urlencoded, which Express would parse into an object instead.
    // It never reaches the handler: the JSON body parser runs in strict mode by
    // default, accepting only objects and arrays at the top level.
    it('rejects a JSON string body before it reaches the handler', async () => {
      const res = await request(app.getHttpServer())
        .post(endpointFor(runA.id))
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Content-Type', 'application/json')
        .send('"[]"');

      expect(res.status).toBe(400);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
    });

    it('accepts a 128-character correlation id and rejects 129 characters', async () => {
      // Multibyte on purpose: PostgreSQL's length() counts characters, not bytes.
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

  describe('missing run', () => {
    it('returns 404 for a token naming a run that does not exist', async () => {
      const ghost = 2147483000;
      const ghostToken = await app
        .get(EarthbeamApiAuthService)
        .createAccessToken({ runId: ghost });

      const res = await request(app.getHttpServer())
        .post(endpointFor(ghost))
        .set('Authorization', `Bearer ${ghostToken}`)
        .send([{ correlation_id: 'c', candidate: { first_name: 'Ada' }, matches: [] }]);

      expect(res.status).toBe(404);
    });
  });

  describe('atomicity', () => {
    // Atomicity is the only reason this endpoint uses a transaction, so it is
    // worth pinning down. No payload can reach it — the pipe and the schema
    // constraints agree, which is the point — so the failure is injected at the
    // database client, after the input and result rows are already written.
    // Without a transaction those two would survive as a result with no
    // suggestions: indistinguishable from a genuine no-match, and permanent,
    // since a retry inserts nothing.
    it('writes nothing when the suggestion insert fails mid-transaction', async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let writtenBeforeFailure: { inputs: number; results: number } | undefined;
      const logs: string[] = [];
      const capture = (message: unknown) => logs.push(String(message));
      const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);

      const client = app.get(PRISMA_ANONYMOUS) as any;
      const realTransaction = client.$transaction.bind(client);
      const spy = jest
        .spyOn(client, '$transaction')
        .mockImplementation((...args: any[]) =>
          realTransaction(async (tx: any) => {
            let executeRawCalls = 0;
            const failing = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop !== '$executeRaw') {
                  return Reflect.get(target, prop, receiver);
                }
                // 1st is the input insert, 2nd the suggestions.
                return async (...callArgs: any[]) => {
                  executeRawCalls += 1;
                  if (executeRawCalls !== 2) {
                    return target.$executeRaw(...callArgs);
                  }
                  // Prove the injection landed where the test claims, rather
                  // than trusting a positional counter: every assertion below
                  // is a zero count, which a failure at the FIRST statement
                  // would satisfy just as well. Read through the same
                  // transaction, so these are its own uncommitted rows.
                  const [{ inputs, results }] = await target.$queryRaw<
                    { inputs: number; results: number }[]
                  >`
                    SELECT
                      (SELECT count(*)::int FROM public.student_input_details
                        WHERE job_id = ${jobA.id}) AS inputs,
                      (SELECT count(*)::int FROM public.student_match_result
                        WHERE job_id = ${jobA.id}) AS results
                  `;
                  writtenBeforeFailure = { inputs, results };
                  throw new Error('injected suggestion insert failure');
                };
              },
            });
            return args[0](failing);
          }, args[1])
        );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      try {
        const res = await post(runA.id, tokenA, [
          {
            correlation_id: 'corr-atomic',
            candidate: { first_name: 'Ada' },
            matches: [{ score: 1, student_unique_id: 'SUID-1' }],
          },
        ]);

        expect(res.status).toBe(500);
        // The failure happened after both rows existed, so the zero counts
        // below are rollback rather than an injection that fired too early.
        expect(writtenBeforeFailure).toEqual({ inputs: 1, results: 1 });
        // An unexpected failure must not quote the payload back, in the
        // response or the log.
        expect(JSON.stringify(res.body)).not.toContain('Ada');
        expect(logs.join('\n')).toContain(`runId=${runA.id}`);
        expect(logs.join('\n')).not.toContain('Ada');
        expect(logs.join('\n')).not.toContain('corr-atomic');
      } finally {
        spy.mockRestore();
        logSpy.mockRestore();
      }

      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(
        await prisma.studentMatchSuggestion.count({
          where: { studentMatchResult: { jobId: jobA.id } },
        })
      ).toBe(0);
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
    // Ordered explicitly: these snapshots are compared elementwise, so relying
    // on incidental row order would make the comparison pass by luck.
    const inputs = await prisma.studentInputDetails.findMany({
      where: { jobId: jobA.id },
      orderBy: { correlationId: 'asc' },
    });
    const results = await prisma.studentMatchResult.findMany({
      where: { jobId: jobA.id },
      orderBy: [{ correlationId: 'asc' }, { runId: 'asc' }],
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

  // Within a run the first report of a group wins. A re-send carrying
  // different suggestions is accepted and ignored rather than rejected: new
  // evidence for the same input is expected to arrive as a new run, which gets
  // its own result row.
  it('keeps the first report when a run re-sends a group with different suggestions', async () => {
    expect((await post(runA.id, tokenA, [record()])).status).toBe(200);
    const before = await snapshot();

    const res = await post(runA.id, tokenA, [
      record({ matches: [{ ...match, score: 0.5, student_unique_id: 'SUID-OTHER' }] }),
    ]);

    expect(res.status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  // Input details are extracted only on a job's first run, so a later run
  // re-sends candidates that already exist and adds only its own result.
  // A run that fails partway leaves groups undelivered, and restarting the job
  // creates a new run on it (JobsService.startJob). That later run must be able
  // to fill the gap, so input rows carry per-row provenance rather than a
  // single establishing run for the whole job.
  it('lets a later run deliver groups an earlier run never reported', async () => {
    expect((await post(runA.id, tokenA, [record()])).status).toBe(200);

    const runB = await prisma.run.create({ data: { jobId: jobA.id, status: 'new' } });
    const tokenB = await app.get(EarthbeamApiAuthService).createAccessToken({ runId: runB.id });

    const res = await post(runB.id, tokenB, [
      record(),
      record({ correlation_id: 'corr-undelivered' }),
    ]);
    expect(res.status).toBe(200);

    const { inputs, results } = await snapshot();
    expect(inputs.map((i) => [i.correlationId, i.sourceRunId])).toEqual([
      ['corr-1', runA.id],
      ['corr-undelivered', runB.id],
    ]);
    // Run B reports on both groups; run A only on the one it delivered.
    expect(results.map((r) => [r.correlationId, r.runId])).toEqual([
      ['corr-1', runA.id],
      ['corr-1', runB.id],
      ['corr-undelivered', runB.id],
    ]);
  });

  it('records a later run as new history', async () => {
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

    // source_run_id is provenance, not ownership. Cascading from it would let
    // deleting one run take every other run's results for the job with it.
    it('refuses to delete the establishing run but cascades from the job', async () => {
      expect((await post(runA.id, tokenA, [record()])).status).toBe(200);
      const runB = await prisma.run.create({ data: { jobId: jobA.id, status: 'new' } });
      const tokenB = await app.get(EarthbeamApiAuthService).createAccessToken({ runId: runB.id });
      expect((await post(runB.id, tokenB, [record()])).status).toBe(200);

      await expect(prisma.run.delete({ where: { id: runA.id } })).rejects.toThrow();
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(2);

      await prisma.job.delete({ where: { id: jobA.id } });
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(0);
    });
  });
});
