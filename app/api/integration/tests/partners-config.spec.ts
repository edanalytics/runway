import request from 'supertest';
import { IdMatchingMode } from '@prisma/client';
import { userA, userX } from '../fixtures/user-fixtures';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { idpA, idpX } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { stubIdrsConfig } from '../helpers/stub-idrs';
import { EduSnowflakePoolService } from 'api/src/earthbeam/api/edu-snowflake-pool.service';

describe('GET /partners/config', () => {
  const endpoint = '/partners/config';
  const userRoleA = 'runway.test.user';
  const partnerAdminRoleA = 'runway.test.partneradmin';

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint);
    expect(res.status).toBe(401);
  });

  it('should reject non-PartnerAdmin users', async () => {
    const cookieA = (await authHelper.login(idpA, userA, tenantA, userRoleA)).cookies;
    const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);
    expect(res.status).toBe(403);
  });

  describe('as PartnerAdmin', () => {
    let adminCookieA: string;
    let canConnectSpy: jest.SpyInstance;

    beforeEach(async () => {
      adminCookieA = (await authHelper.login(idpA, userA, tenantA, partnerAdminRoleA)).cookies;
      // Each test sets the canConnect result it exercises.
      canConnectSpy = jest.spyOn(app.get(EduSnowflakePoolService), 'canConnect');
    });

    afterEach(() => {
      canConnectSpy.mockRestore();
    });

    // The body mirrors the partner's setting columns and canConnect, and is
    // exactly { crossYearMatchingEnabled, idMatchingMode, canConnectToEdu } —
    // asserting the full shape guards against leaking extra partner fields.
    it('returns the settings and EDU creds state (cross-year on, fuzzy)', async () => {
      canConnectSpy.mockResolvedValue(true);
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: true, idMatchingMode: 'fuzzy' },
      });
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [adminCookieA]);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        crossYearMatchingEnabled: true,
        idMatchingMode: 'fuzzy',
        canConnectToEdu: true,
      });
      expect(canConnectSpy).toHaveBeenCalledWith(partnerA.id);
    });

    it('returns the settings and EDU creds state (cross-year off, id_based)', async () => {
      canConnectSpy.mockResolvedValue(false);
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: false, idMatchingMode: 'id_based' },
      });
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [adminCookieA]);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        crossYearMatchingEnabled: false,
        idMatchingMode: 'id_based',
        canConnectToEdu: false,
      });
    });
  });
});

describe('PUT /partners/config', () => {
  const endpoint = '/partners/config';
  const userRoleA = 'runway.test.user';
  const partnerAdminRoleA = 'runway.test.partneradmin';
  const partnerAdminRoleX = 'Runway.PartnerAdmin';
  type Settings = { crossYearMatchingEnabled: boolean; idMatchingMode: IdMatchingMode };
  const saved: Settings = { crossYearMatchingEnabled: false, idMatchingMode: 'id_based' };
  const change = (changes: Partial<Settings>, expected = saved) => ({
    ...expected,
    ...changes,
    expected,
  });
  const savedRow = () =>
    global.prisma.partner.findUniqueOrThrow({
      where: { id: partnerA.id },
      select: { crossYearMatchingEnabled: true, idMatchingMode: true },
    });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer())
      .put(endpoint)
      .send(change({ crossYearMatchingEnabled: true }));
    expect(res.status).toBe(401);
  });

  it('should reject non-PartnerAdmin users', async () => {
    const cookieA = (await authHelper.login(idpA, userA, tenantA, userRoleA)).cookies;
    const res = await request(app.getHttpServer())
      .put(endpoint)
      .set('Cookie', [cookieA])
      .send(change({ crossYearMatchingEnabled: true }));
    expect(res.status).toBe(403);
  });

  describe('as PartnerAdmin', () => {
    let adminCookieA: string;
    let canConnectSpy: jest.SpyInstance;
    let config: ReturnType<typeof stubIdrsConfig>;
    let fetchSpy: jest.SpyInstance;
    // An Error is thrown in place of a response, as a network failure would be.
    let verifyResponse: Response | Error;

    const tokenUrl = 'https://auth.example.test/token';
    // A base path and trailing slash guard joining the verify route.
    const idrsUrl = 'https://idrs.example.test/base/';
    const scopes = [`partner:${partnerA.id}`, 'student:identity:read'];
    const response = (body: unknown, status = 200) =>
      ({ ok: status === 200, status, json: async () => body } as Response);

    const put = (body: object) =>
      request(app.getHttpServer()).put(endpoint).set('Cookie', [adminCookieA]).send(body);

    beforeEach(async () => {
      adminCookieA = (await authHelper.login(idpA, userA, tenantA, partnerAdminRoleA)).cookies;
      canConnectSpy = jest
        .spyOn(app.get(EduSnowflakePoolService), 'canConnect')
        .mockResolvedValue(true);
      config = stubIdrsConfig({ idrsUrl, tokenUrl });
      verifyResponse = response({ scopes: [...scopes, 'extra:scope'] });
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (url === tokenUrl) return response({ access_token: 'token', expires_in: 86400 });
        if (url === `${idrsUrl}token/verify`) {
          if (verifyResponse instanceof Error) throw verifyResponse;
          return verifyResponse;
        }
        throw new Error(`unexpected URL ${url}`);
      });
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: false, idMatchingMode: 'id_based' },
      });
    });

    afterEach(() => jest.restoreAllMocks());

    it.each([
      {
        case: 'an invalid cross-year value',
        body: { ...saved, crossYearMatchingEnabled: 'nope', expected: saved },
      },
      { case: 'an invalid mode', body: { ...saved, idMatchingMode: 'nope', expected: saved } },
      { case: 'no expected values', body: { ...saved, crossYearMatchingEnabled: true } },
      {
        case: 'partial expected values',
        body: { ...saved, expected: { crossYearMatchingEnabled: false } },
      },
    ])('rejects $case', async ({ body }) => {
      expect((await put(body)).status).toBe(400);
      expect(await savedRow()).toEqual(saved);
    });

    // This admin loads the settings, another admin saves a change, then this
    // admin saves a change to the other setting. The body still carries the
    // old value of the setting the other admin changed, so without the stale
    // check this save would succeed and silently revert their change.
    it.each([
      {
        otherAdminChanged: 'cross-year matching',
        otherAdminSaves: { crossYearMatchingEnabled: true },
        thisAdminChanges: { idMatchingMode: 'fuzzy' as const },
      },
      {
        otherAdminChanged: 'the matching mode',
        otherAdminSaves: { idMatchingMode: 'fuzzy' as const },
        thisAdminChanges: { crossYearMatchingEnabled: true },
      },
    ])(
      'refuses a save that started before another admin changed $otherAdminChanged',
      async ({ otherAdminSaves, thisAdminChanges }) => {
        const loaded = await savedRow();
        await global.prisma.partner.update({ where: { id: partnerA.id }, data: otherAdminSaves });

        const res = await put({ ...loaded, ...thisAdminChanges, expected: loaded });

        expect(res.status).toBe(409);
        expect(await savedRow()).toEqual({ ...loaded, ...otherAdminSaves });
      }
    );

    it("updates only the session partner's row", async () => {
      const adminCookieX = (await authHelper.login(idpX, userX, tenantX, partnerAdminRoleX))
        .cookies;
      await global.prisma.partner.update({
        where: { id: 'partner-x' },
        data: { crossYearMatchingEnabled: false, idMatchingMode: 'id_based' },
      });

      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [adminCookieX])
        .send(change({ crossYearMatchingEnabled: true }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });

      const partnerXRow = await global.prisma.partner.findUniqueOrThrow({
        where: { id: 'partner-x' },
      });
      expect(partnerXRow.crossYearMatchingEnabled).toBe(true);

      // Load-bearing: partner A must be left untouched, proving the update is
      // scoped to the session's partnerId rather than affecting other partners.
      expect(await savedRow()).toEqual(saved);
    });

    describe('cross-year matching', () => {
      it('rejects enabling when EDU creds are missing', async () => {
        canConnectSpy.mockResolvedValue(false);
        const res = await put(change({ crossYearMatchingEnabled: true }));
        expect(res.status).toBe(400);
        expect(await savedRow()).toEqual(saved);
      });

      it('allows disabling even when EDU creds are missing', async () => {
        const enabled: Settings = { ...saved, crossYearMatchingEnabled: true };
        await global.prisma.partner.update({ where: { id: partnerA.id }, data: enabled });
        canConnectSpy.mockResolvedValue(false);

        const res = await put(change({ crossYearMatchingEnabled: false }, enabled));
        expect(res.status).toBe(200);
        expect(await savedRow()).toEqual(saved);
      });

      it('skips the EDU check when cross-year matching is unchanged', async () => {
        const enabled: Settings = { ...saved, crossYearMatchingEnabled: true };
        await global.prisma.partner.update({ where: { id: partnerA.id }, data: enabled });
        canConnectSpy.mockResolvedValue(false);

        const res = await put(change({ idMatchingMode: 'fuzzy' }, enabled));
        expect(res.status).toBe(200);
        expect(await savedRow()).toEqual({ ...enabled, idMatchingMode: 'fuzzy' });
        expect(canConnectSpy).not.toHaveBeenCalled();
      });
    });

    describe('matching mode', () => {
      it.each(['fuzzy', 'id_based_fuzzy_background'] as const)(
        'saves %s once IDRS verifies access',
        async (mode) => {
          const res = await put(change({ idMatchingMode: mode }));
          expect(res.status).toBe(200);
          expect(await savedRow()).toEqual({ ...saved, idMatchingMode: mode });
          expect(fetchSpy).toHaveBeenLastCalledWith(
            `${idrsUrl}token/verify`,
            expect.objectContaining({ headers: { Authorization: 'Bearer token' } })
          );
        }
      );

      it.each([
        { case: 'a token without the partner scope', verify: response({ scopes: [scopes[1]] }) },
        { case: 'a token without the search scope', verify: response({ scopes: [scopes[0]] }) },
        {
          case: "another partner's scope",
          verify: response({ scopes: ['partner:other', 'student:identity:read'] }),
        },
        { case: 'space-delimited scopes', verify: response({ scopes: scopes.join(' ') }) },
        { case: 'a rejected token', verify: response({}, 401) },
        {
          case: 'a malformed response',
          verify: {
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError('Unexpected token');
            },
          } as unknown as Response,
        },
        { case: 'a network failure', verify: new TypeError('fetch failed') },
      ])('refuses $case and keeps the saved settings', async ({ verify }) => {
        verifyResponse = verify;
        expect((await put(change({ idMatchingMode: 'fuzzy' }))).status).toBe(400);
        expect(await savedRow()).toEqual(saved);
      });

      it('drops a refused token, so a retry after the fix mints a new one', async () => {
        let minted = 0;
        fetchSpy.mockImplementation(async (url, init) => {
          if (url === tokenUrl) {
            return response({ access_token: `token-${++minted}`, expires_in: 86400 });
          }
          // Only the token minted after the partner's scope is fixed carries it.
          const fixed =
            (init?.headers as Record<string, string>).Authorization === 'Bearer token-2';
          return response({ scopes: fixed ? scopes : [scopes[1]] });
        });
        expect((await put(change({ idMatchingMode: 'fuzzy' }))).status).toBe(400);
        expect((await put(change({ idMatchingMode: 'fuzzy' }))).status).toBe(200);
      });

      it('refuses without the partner’s IDRS connection info', async () => {
        jest.spyOn(config, 'getIdrsConnectionInfo').mockResolvedValue(null);
        expect((await put(change({ idMatchingMode: 'fuzzy' }))).status).toBe(400);
        expect(await savedRow()).toEqual(saved);
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('saves id_based without contacting IDRS', async () => {
        const fuzzy: Settings = { ...saved, idMatchingMode: 'fuzzy' };
        await global.prisma.partner.update({ where: { id: partnerA.id }, data: fuzzy });
        const res = await put(change({ idMatchingMode: 'id_based' }, fuzzy));
        expect(res.status).toBe(200);
        expect(await savedRow()).toEqual(saved);
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('skips the IDRS check when the mode is unchanged', async () => {
        const fuzzy: Settings = { ...saved, idMatchingMode: 'fuzzy' };
        await global.prisma.partner.update({ where: { id: partnerA.id }, data: fuzzy });
        const res = await put(change({ crossYearMatchingEnabled: true }, fuzzy));
        expect(res.status).toBe(200);
        expect(await savedRow()).toEqual({ ...fuzzy, crossYearMatchingEnabled: true });
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('checks IDRS when switching between the fuzzy modes', async () => {
        const fuzzy: Settings = { ...saved, idMatchingMode: 'fuzzy' };
        await global.prisma.partner.update({ where: { id: partnerA.id }, data: fuzzy });
        verifyResponse = response({}, 401);
        const res = await put(change({ idMatchingMode: 'id_based_fuzzy_background' }, fuzzy));
        expect(res.status).toBe(400);
        expect(await savedRow()).toEqual(fuzzy);
      });
    });
  });
});
