import request from 'supertest';
import { Logger } from '@nestjs/common';
import { IdMatchingMode } from '@prisma/client';
import { seedJob } from '../factories/job-factory';
import { bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import {
  odsConfigA2425,
  odsConfigB2526,
  odsConfigX2425,
} from '../fixtures/context-fixtures/ods-fixture';
import {
  tenantA,
  tenantB,
  tenantDGlobal,
  tenantX,
} from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB } from '../fixtures/user-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { reportMatchResults } from '../helpers/report-match-results';
import { withoutPrivilege } from '../helpers/without-privilege';
import { stubIdrsConfig } from '../helpers/stub-idrs';
import { AppConfigService } from '../../src/config/app-config.service';

describe('POST /jobs/:jobId/student-match-results/:correlationId/search', () => {
  const PARTNER_ADMIN = ['runway.test.user', 'runway.test.partneradmin'];
  const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];
  const IDRS_URL = 'https://idrs.example.test';
  const TOKEN_URL = 'https://auth.example.test/oauth/token';
  const UNAVAILABLE = {
    statusCode: 502,
    code: 'identity_service_unavailable',
    message: 'Student search is unavailable. Try again later.',
  };

  /** Corrected details a reviewer might search with. */
  const DETAILS = {
    first_name: 'Ada',
    last_name: 'Lovelace',
    birth_date: '2010-12-10',
    school_ids: [101, 102],
    student_ids: ['S-1'],
  };

  let job: Awaited<ReturnType<typeof seedJob>>;
  let cookies: string;

  /** A job in this mode, with corr-1 reported for its first run. */
  const seedReportedJob = async (idMatchingMode: IdMatchingMode, inTenantB = false) => {
    const seeded = await seedJob({
      odsConfig: inTenantB ? odsConfigB2526 : odsConfigA2425,
      bundle: bundleA,
      tenant: inTenantB ? tenantB : tenantA,
      idMatchingMode,
    });
    await reportMatchResults(seeded.runs[0].id, [
      { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
    ]);
    return seeded;
  };

  const search = (
    body: Record<string, unknown>,
    { jobId = job.id, correlationId = 'corr-1', cookie = cookies } = {}
  ) =>
    request(app.getHttpServer())
      .post(`/jobs/${jobId}/student-match-results/${correlationId}/search`)
      .set('Cookie', cookie ? [cookie] : [])
      .send(body);

  const jsonResponse = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

  const ISSUED_TOKEN = jsonResponse(200, { access_token: 'issued-token', expires_in: 86400 });

  /**
   * Stubs IDRS's two endpoints: the token URL answers with `token`, and any
   * other URL, the search, with `searchResponse`, or rejects with it if it's
   * an error.
   */
  const stubIdrs = (searchResponse: Response | Error, token: Response = ISSUED_TOKEN) =>
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === TOKEN_URL) {
        return token;
      }
      if (searchResponse instanceof Error) {
        throw searchResponse;
      }
      return searchResponse;
    });

  /** IDRS's answer to a search for corr-1. */
  const found = (matches: unknown[]) => jsonResponse(200, [{ correlation_id: 'corr-1', matches }]);

  /** A match as IDRS returns it, in the given school years. */
  const idrsMatch = (studentUniqueId: string, schoolYears: number[], score = 0.9) => ({
    student_unique_id: studentUniqueId,
    score,
    first_name: 'Ada',
    middle_name: null,
    last_name: 'Lovelace',
    birth_date: '2010-12-10',
    student_ids: [{ id_type: 'State', id_value: 'S-1' }],
    school_years: schoolYears,
  });

  /** The search requests sent to IDRS, leaving out token requests. */
  const searchCalls = (fetchSpy: jest.SpyInstance) =>
    fetchSpy.mock.calls.filter(([url]) => url !== TOKEN_URL);

  const setCrossYearMatching = (enabled: boolean) =>
    prisma.partner.update({
      where: { id: tenantA.partnerId },
      data: { crossYearMatchingEnabled: enabled },
    });

  beforeEach(async () => {
    job = await seedReportedJob('fuzzy');
    ({ cookies } = await authHelper.login(idpA, userA, tenantA));

    stubIdrsConfig({ idrsUrl: IDRS_URL, tokenUrl: TOKEN_URL });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authentication and authorization', () => {
    it('rejects an unauthenticated request', async () => {
      const fetchSpy = stubIdrs(found([]));

      const res = await search(DETAILS, { cookie: '' });

      expect(res.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects a user from another tenant, and lets the job’s own tenant search', async () => {
      const fetchSpy = stubIdrs(found([]));
      const { cookies: other } = await authHelper.login(idpA, userB, tenantB);

      const refused = await search(DETAILS, { cookie: other });

      expect(refused.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();

      const allowed = await search(DETAILS);

      expect(allowed.status).toBe(200);
    });

    it('rejects a user without the match results search privilege', async () => {
      const fetchSpy = stubIdrs(found([]));

      // Every role has it, so take it from the session.
      const res = await withoutPrivilege('job.match-results.search', () => search(DETAILS));

      expect(res.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('lets a support user search across tenants, as the job’s own tenant', async () => {
      const fetchSpy = stubIdrs(found([]));
      const tenantBJob = await seedReportedJob('fuzzy', true);
      const { cookies: support } = await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_USER);

      const res = await search(DETAILS, { jobId: tenantBJob.id, cookie: support });

      expect(res.status).toBe(200);
      expect(searchCalls(fetchSpy).map(([url]) => url)).toEqual([
        `${IDRS_URL}/partners/${tenantB.partnerId}/tenants/${tenantB.code}/students/search`,
      ]);
    });

    // Search mints a token for the job's partner, so letting a support user
    // through here would hand them another partner's IDRS directory.
    it('refuses a support user a job in another partner’s tenant', async () => {
      const fetchSpy = stubIdrs(found([]));
      const partnerXJob = await seedJob({
        odsConfig: odsConfigX2425,
        bundle: bundleX,
        tenant: tenantX,
        idMatchingMode: 'fuzzy',
      });
      await reportMatchResults(partnerXJob.runs[0].id, [
        { correlation_id: 'corr-1', candidate: { first_name: 'Ada' }, matches: [] },
      ]);
      const { cookies: support } = await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_USER);

      const res = await search(DETAILS, { jobId: partnerXJob.id, cookie: support });

      expect(res.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('by matching mode', () => {
    it.each<IdMatchingMode>(['id_based_fuzzy_background', 'id_based'])(
      'refuses a search on a job in %s mode, even from a partner admin',
      async (mode) => {
        const fetchSpy = stubIdrs(found([]));
        const other = await seedReportedJob(mode);
        const { cookies: admin } = await authHelper.login(idpA, userA, tenantA, PARTNER_ADMIN);

        const res = await search(DETAILS, { jobId: other.id, cookie: admin });

        expect(res.status).toBe(403);
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    );
  });

  it.each([
    ['a student the job doesn’t have', 'corr-unknown'],
    // PostgreSQL text can't hold one, so it must not reach a query.
    ['a correlation id with a NUL', 'corr%00'],
  ])('returns 404 for %s, without searching', async (_, correlationId) => {
    const fetchSpy = stubIdrs(found([]));

    const res = await search(DETAILS, { correlationId });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'not_found',
      message: 'This student isn’t in the job.',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // IDRS rejects each of these with a 400, which would surface as a 502.
  it.each<[string, Record<string, unknown>, string]>([
    ['a birth date that isn’t YYYY-MM-DD', { birth_date: '12/10/2010' }, 'birth_date'],
    ['an impossible birth date', { birth_date: '2010-02-30' }, 'birth_date'],
    ['a birth date with a time', { birth_date: '2010-12-10T00:00:00Z' }, 'birth_date'],
    ['a school id that isn’t an integer', { school_ids: [101, 1.5] }, 'school_ids'],
    ['school ids that aren’t a list', { school_ids: 101 }, 'school_ids'],
    ['a student id that isn’t a string', { student_ids: [123] }, 'student_ids'],
    ['a name that isn’t a string', { first_name: 7 }, 'first_name'],
  ])('refuses %s, without searching', async (_, given, field) => {
    const fetchSpy = stubIdrs(found([]));

    const res = await search({ ...DETAILS, ...given });

    expect(res.status).toBe(400);
    // Nest's validation body, so it was the DTO that refused it.
    expect(res.body.message).toContainEqual(
      expect.stringMatching(new RegExp(`^(each value in )?${field} `))
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('the request to IDRS', () => {
    it('sends only IDRS’s own fields to the job’s tenant’s search route', async () => {
      const fetchSpy = stubIdrs(found([]));

      const res = await search({ ...DETAILS, middle_name: 'Augusta' });

      expect(res.status).toBe(200);
      const calls = searchCalls(fetchSpy);
      expect(calls).toHaveLength(1);
      const [url, init] = calls[0];
      expect(url).toBe(
        `${IDRS_URL}/partners/${tenantA.partnerId}/tenants/${tenantA.code}/students/search`
      );
      expect(init).toMatchObject({
        method: 'POST',
        headers: { Authorization: 'Bearer issued-token', 'Content-Type': 'application/json' },
      });
      // Pins the timeout, which no test waits out.
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(init.body)).toEqual([{ correlation_id: 'corr-1', ...DETAILS }]);
    });

    it('leaves out the fields the reviewer didn’t give', async () => {
      const fetchSpy = stubIdrs(found([]));

      const res = await search({ last_name: 'Lovelace' });

      expect(res.status).toBe(200);
      expect(JSON.parse(searchCalls(fetchSpy)[0][1].body)).toEqual([
        { correlation_id: 'corr-1', last_name: 'Lovelace' },
      ]);
    });
  });

  describe('the hits', () => {
    it('returns IDRS’s matches in its order, with their roster details as returned', async () => {
      stubIdrs(
        found([
          { ...idrsMatch('SUID-1', [2025], 0.97), future_field: 'kept' },
          idrsMatch('SUID-2', [2025], 0.41),
        ])
      );

      const res = await search(DETAILS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        hits: [
          {
            studentUniqueId: 'SUID-1',
            score: 0.97,
            rosterDetails: {
              first_name: 'Ada',
              middle_name: null,
              last_name: 'Lovelace',
              birth_date: '2010-12-10',
              student_ids: [{ id_type: 'State', id_value: 'S-1' }],
              school_years: [2025],
              future_field: 'kept',
            },
          },
          {
            studentUniqueId: 'SUID-2',
            score: 0.41,
            rosterDetails: {
              first_name: 'Ada',
              middle_name: null,
              last_name: 'Lovelace',
              birth_date: '2010-12-10',
              student_ids: [{ id_type: 'State', id_value: 'S-1' }],
              school_years: [2025],
            },
          },
        ],
      });
    });

    it('returns no hits when IDRS finds no one', async () => {
      stubIdrs(found([]));

      const res = await search(DETAILS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hits: [] });
    });
  });

  // The job is for 2024–25, so its end year is 2025.
  describe('the school-year rule', () => {
    const acrossYears = () =>
      found([
        idrsMatch('SUID-BOTH', [2024, 2025]),
        idrsMatch('SUID-2025', [2025]),
        idrsMatch('SUID-2024', [2024]),
        idrsMatch('SUID-NONE', []),
      ]);
    const hitIds = (res: request.Response) =>
      res.body.hits.map((hit: { studentUniqueId: string }) => hit.studentUniqueId);

    it('keeps only students in the job’s year without cross-year matching', async () => {
      stubIdrs(acrossYears());

      const res = await search(DETAILS);

      expect(res.status).toBe(200);
      expect(hitIds(res)).toEqual(['SUID-BOTH', 'SUID-2025']);
    });

    it('keeps every student with cross-year matching', async () => {
      await setCrossYearMatching(true);
      stubIdrs(acrossYears());

      const res = await search(DETAILS);

      expect(res.status).toBe(200);
      expect(hitIds(res)).toEqual(['SUID-BOTH', 'SUID-2025', 'SUID-2024', 'SUID-NONE']);
    });

    it('follows the partner’s current setting, not the job’s', async () => {
      stubIdrs(acrossYears());

      const before = await search(DETAILS);
      await setCrossYearMatching(true);
      const after = await search(DETAILS);

      expect(hitIds(before)).toEqual(['SUID-BOTH', 'SUID-2025']);
      expect(hitIds(after)).toEqual(['SUID-BOTH', 'SUID-2025', 'SUID-2024', 'SUID-NONE']);
    });
  });

  describe('when IDRS can’t answer', () => {
    it.each<[string, () => Response | Error]>([
      [
        'the search times out',
        () => Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      ],
      [
        'the search is refused as invalid',
        () => jsonResponse(400, { error: 'invalid_request', details: [{ path: '0.birth_date' }] }),
      ],
      ['the partner isn’t provisioned', () => jsonResponse(404, { error: 'partner_not_found' })],
      ['the search fails', () => jsonResponse(500, { error: 'search_error' })],
      [
        'the response isn’t JSON',
        () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError('Unexpected token');
            },
          } as unknown as Response),
      ],
      ['the response has no results', () => jsonResponse(200, [])],
      [
        'the response has two results',
        () =>
          jsonResponse(200, [
            { correlation_id: 'corr-1', matches: [] },
            { correlation_id: 'corr-2', matches: [] },
          ]),
      ],
      [
        'the response is for another student',
        () => jsonResponse(200, [{ correlation_id: 'corr-2', matches: [] }]),
      ],
      ['the response has no matches list', () => jsonResponse(200, [{ correlation_id: 'corr-1' }])],
      [
        'a match has no student unique id',
        () => found([{ ...idrsMatch('SUID-1', [2025]), student_unique_id: undefined }]),
      ],
      [
        'a match’s score isn’t a number',
        () => found([{ ...idrsMatch('SUID-1', [2025]), score: '0.9' }]),
      ],
    ])('returns 502 when %s', async (_, searchResponse) => {
      stubIdrs(searchResponse());

      const res = await search(DETAILS);

      expect(res.status).toBe(502);
      expect(res.body).toEqual(UNAVAILABLE);
    });

    it('returns 502 without searching when the token is refused', async () => {
      const fetchSpy = stubIdrs(found([]), jsonResponse(401, {}));

      const res = await search(DETAILS);

      expect(res.status).toBe(502);
      expect(res.body).toEqual(UNAVAILABLE);
      expect(searchCalls(fetchSpy)).toEqual([]);
    });

    it('returns 502 without searching when the partner has no IDRS connection info', async () => {
      jest.spyOn(app.get(AppConfigService), 'getIdrsConnectionInfo').mockResolvedValue(null);
      const fetchSpy = stubIdrs(found([]));

      const res = await search(DETAILS);

      expect(res.status).toBe(502);
      expect(res.body).toEqual(UNAVAILABLE);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('logs one line per search, with ids and outcomes but no student data', async () => {
    const logs: string[] = [];
    const capture = (message: unknown) => {
      logs.push(String(message));
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);
    const searched = {
      first_name: 'Zebediah',
      last_name: 'Quuxworth',
      birth_date: '1999-09-09',
      school_ids: [987654],
      student_ids: ['SID-XYZZY'],
    };
    const fetchSpy = stubIdrs(
      found([
        { ...idrsMatch('SUID-PLUGH', [2025]), first_name: 'Hortensia', last_name: 'Frobnitz' },
      ])
    );

    const ok = await search(searched);
    expect(ok.status).toBe(200);

    // IDRS's 400 details describe the student's fields.
    fetchSpy.mockResolvedValue(
      jsonResponse(400, {
        error: 'invalid_request',
        details: [{ path: '0.first_name', message: 'Zebediah is not allowed' }],
      })
    );
    const failed = await search(searched);
    expect(failed.status).toBe(502);
    // The 502's body carries none of it either.
    expect(JSON.stringify(failed.body)).not.toContain('Zebediah');

    const lines = logs.filter((line) => line.startsWith('student match search:'));
    expect(lines).toEqual([
      expect.stringMatching(
        new RegExp(
          `^student match search: jobId=${job.id} partnerId=${tenantA.partnerId} userId=${userA.id} outcome=SUCCESS `
        )
      ),
      expect.stringMatching(
        new RegExp(
          `^student match search: jobId=${job.id} partnerId=${tenantA.partnerId} userId=${userA.id} outcome=identity_service_unavailable .*status 400`
        )
      ),
    ]);
    const combined = logs.join('\n');
    for (const studentData of [
      'Zebediah',
      'Quuxworth',
      '1999-09-09',
      '987654',
      'SID-XYZZY',
      'SUID-PLUGH',
      'Hortensia',
      'Frobnitz',
      'corr-1',
      'issued-token',
    ]) {
      expect(combined).not.toContain(studentData);
    }
  });
});
