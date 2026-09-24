import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import request from 'supertest';
import { seedJob } from '../factories/job-factory';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA } from '../fixtures/context-fixtures/tenant-fixtures';
import { Job, Prisma, Run } from '@prisma/client';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { Logger } from '@nestjs/common';

/** A student value that must never appear in a response body or a log. */
const SENTINEL = 'Sentinel-Never-In-A-Response';

const endpointFor = (runId: number) => `/earthbeam/jobs/${runId}/student-match-results`;

describe('POST /earthbeam/jobs/:runId/student-match-results', () => {
  let jobA: Job;
  let runA: Run;

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
    last_name: 'Lovelace',
    birth_date: '1815-12-10',
    student_ids: [{ id_type: 'state', id_value: 'ST-1' }],
    school_years: [2025],
  };
  const record = (overrides: Record<string, unknown> = {}) => ({
    correlation_id: 'corr-1',
    candidate,
    matches: [match],
    ...overrides,
  });

  const tokenFor = (runId: number) => app.get(EarthbeamApiAuthService).createAccessToken({ runId });

  const post = async (runId: number, body: unknown, token?: string) =>
    request(app.getHttpServer())
      .post(endpointFor(runId))
      .set('Authorization', `Bearer ${token ?? (await tokenFor(runId))}`)
      .send(body as object);

  /** A later run of job A. */
  const newRunOfJobA = () => prisma.run.create({ data: { jobId: jobA.id, status: 'new' } });

  const snapshot = async () => ({
    inputs: await prisma.studentInputDetails.findMany({
      where: { jobId: jobA.id },
      orderBy: { correlationId: 'asc' },
    }),
    results: await prisma.studentMatchResult.findMany({
      where: { jobId: jobA.id },
      orderBy: [{ correlationId: 'asc' }, { runId: 'asc' }],
      include: { studentMatchSuggestion: { orderBy: { ordinal: 'asc' } } },
    }),
  });

  const captureErrorLogs = () => {
    const logs: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    return { text: () => logs.join('\n'), restore: () => spy.mockRestore() };
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
  });

  describe('authentication', () => {
    it('rejects a request without a token without writing rows', async () => {
      const res = await request(app.getHttpServer()).post(endpointFor(runA.id)).send([record()]);

      expect(res.status).toBe(401);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
    });

    it('rejects a token issued for another run without writing rows', async () => {
      const otherJob = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });

      const res = await post(runA.id, [record()], await tokenFor(otherJob.runs[0].id));

      expect(res.status).toBe(403);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
    });
  });

  describe('ingestion', () => {
    it('stores input details, a result for this run, and its suggestions in order', async () => {
      const res = await post(runA.id, [
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

      expect(res.status).toBe(201);
      expect(
        await prisma.studentInputDetails.findMany({
          where: { jobId: jobA.id },
          orderBy: { correlationId: 'asc' },
        })
      ).toEqual([
        {
          jobId: jobA.id,
          correlationId: 'corr-1',
          sourceRunId: runA.id,
          inputDetails: { first_name: 'Ada', last_name: 'Lovelace' },
          createdOn: expect.any(Date),
        },
        {
          jobId: jobA.id,
          correlationId: 'corr-2',
          sourceRunId: runA.id,
          inputDetails: { first_name: 'Grace' },
          createdOn: expect.any(Date),
        },
      ]);
      expect(
        await prisma.studentMatchResult.findMany({
          where: { jobId: jobA.id },
          orderBy: { correlationId: 'asc' },
          include: { studentMatchSuggestion: { orderBy: { ordinal: 'asc' } } },
        })
      ).toEqual([
        {
          id: expect.any(BigInt),
          jobId: jobA.id,
          correlationId: 'corr-1',
          runId: runA.id,
          createdOn: expect.any(Date),
          studentMatchSuggestion: [
            {
              resultId: expect.any(BigInt),
              ordinal: 0,
              studentUniqueId: 'SUID-1',
              score: new Prisma.Decimal('0.97'),
              rosterDetails: { first_name: 'Ada' },
            },
            {
              resultId: expect.any(BigInt),
              ordinal: 1,
              studentUniqueId: 'SUID-2',
              score: new Prisma.Decimal('0.42'),
              rosterDetails: { first_name: 'Adah' },
            },
          ],
        },
        {
          id: expect.any(BigInt),
          jobId: jobA.id,
          correlationId: 'corr-2',
          runId: runA.id,
          createdOn: expect.any(Date),
          // A result even with no suggestions: "searched, found nothing" is
          // not the same as "never searched".
          studentMatchSuggestion: [],
        },
      ]);
    });

    it('accepts an empty batch', async () => {
      const res = await post(runA.id, []);

      expect(res.status).toBe(201);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
    });

    it('stores what the Executor sends, including keys the app does not read yet', async () => {
      const sent = {
        first_name: 'Ada',
        // Malformed on purpose: a bad date may be exactly why a record needs
        // review, so details are stored rather than validated.
        birth_date: '1815-13-45',
        correlation_id: 'nested',
        added_by_idrs_later: 'kept',
      };
      const res = await post(runA.id, [
        {
          correlation_id: 'corr-as-sent',
          candidate: sent,
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

      expect(res.status).toBe(201);
      const { inputs, results } = await snapshot();
      expect(inputs[0].inputDetails).toEqual(sent);
      // The match as sent, minus the two fields stored as columns. Fields the
      // match omitted stay omitted.
      expect(results[0].studentMatchSuggestion[0].rosterDetails).toEqual({
        first_name: 'Ada',
        added_by_idrs_later: 'kept',
        student_ids: ['bare-string', { id_type: 'state', extra: 'kept' }],
      });
    });
  });

  describe('rejected payloads', () => {
    // The sentinel sits in both the candidate and a match, so a rejection that
    // quoted either back would show.
    const rejected = (overrides: Record<string, unknown> = {}) =>
      record({
        candidate: { first_name: SENTINEL },
        matches: [{ ...match, first_name: SENTINEL }],
        ...overrides,
      });

    const expectRejectedCleanly = async (res: request.Response, status: number) => {
      expect(res.status).toBe(status);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain(SENTINEL);
    };

    // One case per rule the DTO enforces.
    it.each([
      ['a top-level object instead of an array', rejected()],
      ['a record that is not an object', [5]],
      ['a candidate that is not an object', [rejected({ candidate: [] })]],
      ['a match that is not an object', [rejected({ matches: ['nope'] })]],
      [
        'an empty student id',
        [rejected({ matches: [{ ...match, first_name: SENTINEL, student_unique_id: '' }] })],
      ],
      [
        'a nonnumeric score',
        [rejected({ matches: [{ ...match, first_name: SENTINEL, score: 'high' }] })],
      ],
    ])('rejects %s with 400', async (_label, body) => {
      await expectRejectedCleanly(await post(runA.id, body), 400);
    });

    // Only the DTO catches this: without it, the record would be stored as
    // "IDRS found nothing". The body is the Executor's diagnosis.
    it('rejects a record without matches, naming the record in the body', async () => {
      const res = await post(runA.id, [rejected(), rejected({ matches: undefined })]);

      await expectRejectedCleanly(res, 400);
      expect(res.body.message).toContain('[1] matches must be an array');
    });

    it('bounds correlation ids at 1 to 128 characters, not bytes', async () => {
      // Multibyte on purpose: PostgreSQL's length() counts characters.
      const id = (n: number) => 'é'.repeat(n);

      expect((await post(runA.id, [record({ correlation_id: '' })])).status).toBe(400);
      expect((await post(runA.id, [record({ correlation_id: id(129) })])).status).toBe(400);
      expect((await post(runA.id, [record({ correlation_id: id(128) })])).status).toBe(201);
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(1);
    });

    // No app check needed: both match lists claim ordinal 0 under one result
    // and violate the suggestion primary key.
    it('lets the database refuse two records that share a correlation id and both carry matches', async () => {
      const logs = captureErrorLogs();
      try {
        const res = await post(runA.id, [rejected(), rejected()]);

        await expectRejectedCleanly(res, 500);
        // 23505: unique_violation. The SQLSTATE is the diagnosis.
        expect(logs.text()).toContain('sqlstate=23505');
      } finally {
        logs.restore();
      }
    });
  });

  describe('failures', () => {
    it('returns 404 for a token naming a run that does not exist', async () => {
      const ghost = 2147483000;

      const res = await post(ghost, [record()]); // post generates a valid token for the ghost run

      expect(res.status).toBe(404);
    });

    // No payload the DTO passes can make the suggestion insert fail, so the
    // failure is injected at the database client, after the input and result
    // rows are written.
    it('writes nothing when the suggestion insert fails mid-transaction', async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      let writtenBeforeFailure: { inputs: number; results: number } | undefined;
      const client = app.get(PRISMA_ANONYMOUS) as any;
      const realTransaction = client.$transaction.bind(client);
      const transactionSpy = jest
        .spyOn(client, '$transaction')
        .mockImplementation((...args: any[]) =>
          realTransaction(async (tx: any) => {
            let executeRawCalls = 0;
            const failing = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop !== '$executeRaw') {
                  return Reflect.get(target, prop, receiver);
                }
                // The 1st is the input insert, the 2nd the suggestions.
                return async (...callArgs: any[]) => {
                  executeRawCalls += 1;
                  if (executeRawCalls !== 2) {
                    return target.$executeRaw(...callArgs);
                  }
                  // Prove the injection landed where the test claims: the zero
                  // counts below would be just as true of a failure at the first
                  // statement. Read through the same transaction, so these are its
                  // own uncommitted rows.
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
                  // Quotes student data, as a real constraint violation's detail
                  // would; neither the response nor the log may repeat it.
                  throw new Error(`Failing row contains (${SENTINEL})`);
                };
              },
            });
            return args[0](failing);
          }, args[1])
        );
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const logs = captureErrorLogs();

      try {
        const res = await post(runA.id, [record()]);

        expect(res.status).toBe(500);
        expect(writtenBeforeFailure).toEqual({ inputs: 1, results: 1 });
        expect(JSON.stringify(res.body)).not.toContain(SENTINEL);
        expect(logs.text()).toContain(`runId=${runA.id}`);
        expect(logs.text()).not.toContain(SENTINEL);
      } finally {
        transactionSpy.mockRestore();
        logs.restore();
      }

      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(0);
    });
  });

  describe('retries and runs', () => {
    // The Executor re-sends exactly what it sent, though not necessarily in the
    // same batches.
    it('ignores a retry within the same run, however it is batched', async () => {
      const [stored, storedEmpty, undelivered] = [
        record(),
        record({ correlation_id: 'corr-2', matches: [] }),
        record({ correlation_id: 'corr-3' }),
      ];
      expect((await post(runA.id, [stored, storedEmpty])).status).toBe(201);
      const before = await snapshot();

      // Rebatched: a stored group alongside one not yet delivered, then another alone.
      for (const retry of [[stored, undelivered], [storedEmpty]]) {
        expect((await post(runA.id, retry)).status).toBe(201);
      }

      // Stored groups are neither duplicated nor rewritten; the new one is added.
      const after = await snapshot();
      expect(after.inputs.slice(0, 2)).toEqual(before.inputs);
      expect(after.results.slice(0, 2)).toEqual(before.results);
      expect(after.results.map((r) => [r.correlationId, r.studentMatchSuggestion.length])).toEqual([
        ['corr-1', 1],
        ['corr-2', 0],
        ['corr-3', 1],
      ]);
    });

    // Results are keyed by run, so a later search of the same input adds
    // history instead of overwriting the first.
    it('records a later run as new history', async () => {
      expect((await post(runA.id, [record()])).status).toBe(201);
      const before = await snapshot();
      const runB = await newRunOfJobA();

      const res = await post(runB.id, [
        record({ matches: [{ ...match, student_unique_id: 'SUID-9' }] }),
      ]);

      expect(res.status).toBe(201);
      const after = await snapshot();
      // The input row still names the run that established it.
      expect(after.inputs).toEqual(before.inputs);
      expect(after.results[0]).toEqual(before.results[0]);
      expect(
        after.results.map((r) => [r.runId, r.studentMatchSuggestion.map((s) => s.studentUniqueId)])
      ).toEqual([
        [runA.id, ['SUID-1']],
        [runB.id, ['SUID-9']],
      ]);
    });

    // Processing the same file again means a new job, which produces the same
    // correlation ids; they must not collide with the first job's.
    it('keeps the same correlation id in another job separate', async () => {
      const otherJob = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
        idMatchingMode: 'fuzzy',
      });

      expect((await post(runA.id, [record()])).status).toBe(201);
      expect((await post(otherJob.runs[0].id, [record()])).status).toBe(201);

      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(1);
      expect(await prisma.studentMatchResult.count({ where: { jobId: otherJob.id } })).toBe(1);
    });
  });

  // The composite foreign keys, tested directly: they guarantee a referenced
  // run belongs to the referenced job however a row is written.
  describe('schema-level ownership', () => {
    // Raw query failures carry PostgreSQL's SQLSTATE; 23503 is foreign_key_violation.
    const foreignKeyViolation = { code: 'P2010', meta: { code: '23503' } };

    it('refuses an input row whose source run belongs to another job', async () => {
      const otherJob = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });

      await expect(
        prisma.$executeRaw`
          INSERT INTO public.student_input_details
            (job_id, correlation_id, source_run_id, input_details)
          VALUES (${jobA.id}, 'corr-bad', ${otherJob.runs[0].id}, '{}'::jsonb)
        `
      ).rejects.toMatchObject(foreignKeyViolation);
    });

    it('refuses a result row whose run belongs to another job', async () => {
      const otherJob = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });
      expect((await post(runA.id, [record()])).status).toBe(201);

      await expect(
        prisma.$executeRaw`
          INSERT INTO public.student_match_result (job_id, correlation_id, run_id)
          VALUES (${jobA.id}, 'corr-1', ${otherJob.runs[0].id})
        `
      ).rejects.toMatchObject(foreignKeyViolation);
    });

    // source_run_id is provenance, not ownership. Cascading from it would let
    // deleting one run take every other run's results for the job with it.
    it('refuses to delete the establishing run but cascades from the job', async () => {
      expect((await post(runA.id, [record()])).status).toBe(201);
      const runB = await newRunOfJobA();
      expect((await post(runB.id, [record()])).status).toBe(201);

      await expect(prisma.run.delete({ where: { id: runA.id } })).rejects.toMatchObject({
        code: 'P2003',
      });
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(2);

      await prisma.job.delete({ where: { id: jobA.id } });
      expect(await prisma.studentInputDetails.count({ where: { jobId: jobA.id } })).toBe(0);
      expect(await prisma.studentMatchResult.count({ where: { jobId: jobA.id } })).toBe(0);
    });
  });
});
