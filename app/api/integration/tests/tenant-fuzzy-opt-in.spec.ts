import request from 'supertest';
import { userA } from '../fixtures/user-fixtures';
import {
  tenantA,
  tenantB,
  tenantC,
  tenantDGlobal,
  tenantEGlobal,
  tenantX,
} from '../fixtures/context-fixtures/tenant-fixtures';
import { partnerA, partnerX } from '../fixtures/context-fixtures/partner-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { withoutPrivilege } from '../helpers/without-privilege';
import { IdrsCredentialsService } from '../../src/idrs/idrs-credentials.service';

const USER = 'runway.test.user';
const PARTNER_ADMIN = 'runway.test.partneradmin';
const SUPPORT_USER = ['runway.test.user', 'runway.test.supportuser'];

describe('GET /partners/tenant-fuzzy-opt-ins', () => {
  const endpoint = '/partners/tenant-fuzzy-opt-ins';

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint);
    expect(res.status).toBe(401);
  });

  it.each([
    { who: 'a user', roles: USER },
    { who: 'a support user', roles: SUPPORT_USER },
  ])('rejects $who', async ({ roles }) => {
    const { cookies } = await authHelper.login(idpA, userA, tenantA, roles);
    const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);
    expect(res.status).toBe(403);
  });

  it('rejects a partner admin without the partner-config read privilege', async () => {
    const { cookies } = await authHelper.login(idpA, userA, tenantA, PARTNER_ADMIN);
    const res = await withoutPrivilege('partner-config.read', () =>
      request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies])
    );
    expect(res.status).toBe(403);
  });

  it("lists every tenant of the session's partner by code, with its opt-in", async () => {
    // Created after the seed, so it sorts first by code but comes last in
    // insertion order. Soft-deleted, since those can still get jobs.
    const newTenant = await global.prisma.tenant.create({
      data: { code: 'tenant-0', partnerId: partnerA.id, deletedOn: new Date() },
    });
    // Opt-ins under other partners, including one sharing partner A's IdP.
    await global.prisma.tenantFuzzyOptIn.createMany({
      data: [tenantB, tenantEGlobal, tenantC, tenantX].map(({ code, partnerId }) => ({
        tenantCode: code,
        partnerId,
      })),
    });
    const { cookies } = await authHelper.login(idpA, userA, tenantA, PARTNER_ADMIN);

    const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookies]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tenants: [
        { tenantCode: newTenant.code, fuzzyOptIn: false },
        { tenantCode: tenantA.code, fuzzyOptIn: false },
        { tenantCode: tenantB.code, fuzzyOptIn: true },
        { tenantCode: tenantDGlobal.code, fuzzyOptIn: false },
        { tenantCode: tenantEGlobal.code, fuzzyOptIn: true },
      ],
    });
  });
});

describe('PUT /partners/tenant-fuzzy-opt-ins/:tenantCode', () => {
  const endpoint = (tenantCode: string) => `/partners/tenant-fuzzy-opt-ins/${tenantCode}`;
  const optIns = () => global.prisma.tenantFuzzyOptIn.findMany({ orderBy: { tenantCode: 'asc' } });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer())
      .put(endpoint(tenantB.code))
      .send({ fuzzyOptIn: true });
    expect(res.status).toBe(401);
  });

  it.each([
    { who: 'a user', roles: USER },
    { who: 'a support user', roles: SUPPORT_USER },
  ])('rejects $who', async ({ roles }) => {
    const { cookies } = await authHelper.login(idpA, userA, tenantA, roles);
    const res = await request(app.getHttpServer())
      .put(endpoint(tenantB.code))
      .set('Cookie', [cookies])
      .send({ fuzzyOptIn: true });
    expect(res.status).toBe(403);
    expect(await optIns()).toEqual([]);
  });

  it('rejects a partner admin without the partner-config update privilege', async () => {
    const { cookies } = await authHelper.login(idpA, userA, tenantA, PARTNER_ADMIN);
    const res = await withoutPrivilege('partner-config.update', () =>
      request(app.getHttpServer())
        .put(endpoint(tenantB.code))
        .set('Cookie', [cookies])
        .send({ fuzzyOptIn: true })
    );
    expect(res.status).toBe(403);
    expect(await optIns()).toEqual([]);
  });

  describe('as PartnerAdmin', () => {
    let adminCookieA: string;
    let verifyAccess: jest.SpyInstance;

    const put = (tenantCode: string, body: object) =>
      request(app.getHttpServer())
        .put(endpoint(tenantCode))
        .set('Cookie', [adminCookieA])
        .send(body);

    beforeEach(async () => {
      adminCookieA = (await authHelper.login(idpA, userA, tenantA, PARTNER_ADMIN)).cookies;
      // The gate's own cases are in partners-config.spec.ts.
      verifyAccess = jest
        .spyOn(app.get(IdrsCredentialsService), 'verifyAccess')
        .mockResolvedValue(true);
    });

    afterEach(() => jest.restoreAllMocks());

    it('opts a tenant in once IDRS verifies access, attributed to the admin', async () => {
      const res = await put(tenantB.code, { fuzzyOptIn: true });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tenantCode: tenantB.code, fuzzyOptIn: true });
      expect(await optIns()).toEqual([
        expect.objectContaining({
          tenantCode: tenantB.code,
          partnerId: partnerA.id,
          createdById: userA.id,
        }),
      ]);
      expect(verifyAccess).toHaveBeenCalledWith(partnerA.id);
      const partner = await global.prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } });
      expect(partner.idMatchingMode).toBe('id_based');
    });

    it("opts in only the path's tenant, ignoring other fields in the body", async () => {
      const res = await put(tenantB.code, {
        fuzzyOptIn: true,
        tenantCode: tenantX.code,
        partnerId: partnerX.id,
      });

      expect(res.status).toBe(200);
      expect(await optIns()).toEqual([
        expect.objectContaining({ tenantCode: tenantB.code, partnerId: partnerA.id }),
      ]);
    });

    it('keeps an existing opt-in as it was, without contacting IDRS', async () => {
      // Created outside a session, so it has no creator; a re-insert by the
      // admin would record one.
      const existing = await global.prisma.tenantFuzzyOptIn.create({
        data: { tenantCode: tenantB.code, partnerId: partnerA.id },
      });

      const res = await put(tenantB.code, { fuzzyOptIn: true });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tenantCode: tenantB.code, fuzzyOptIn: true });
      expect(await optIns()).toEqual([existing]);
      expect(verifyAccess).not.toHaveBeenCalled();
    });

    // Opting out never contacts IDRS, so it works while IDRS is unreachable.
    it.each([
      { case: 'an opted-in tenant', optedIn: true },
      { case: 'a tenant that is not opted in', optedIn: false },
    ])('opts out $case without contacting IDRS', async ({ optedIn }) => {
      const otherOptIn = await global.prisma.tenantFuzzyOptIn.create({
        data: { tenantCode: tenantA.code, partnerId: partnerA.id },
      });
      if (optedIn) {
        await global.prisma.tenantFuzzyOptIn.create({
          data: { tenantCode: tenantB.code, partnerId: partnerA.id },
        });
      }

      const res = await put(tenantB.code, { fuzzyOptIn: false });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tenantCode: tenantB.code, fuzzyOptIn: false });
      expect(await optIns()).toEqual([otherOptIn]);
      expect(verifyAccess).not.toHaveBeenCalled();
    });

    it('refuses to opt in when IDRS access is not verified', async () => {
      verifyAccess.mockResolvedValue(false);

      const res = await put(tenantB.code, { fuzzyOptIn: true });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message:
          "Runway could not verify this partner's IDRS access, so the tenant wasn't opted in. Check the partner's IDRS credentials and scopes, or try again if IDRS is unavailable.",
      });
      expect(await optIns()).toEqual([]);
    });

    it.each([
      { case: 'a missing', body: {} },
      { case: 'a null', body: { fuzzyOptIn: null } },
      { case: 'a string', body: { fuzzyOptIn: 'true' } },
      { case: 'a numeric', body: { fuzzyOptIn: 1 } },
    ])('rejects $case fuzzyOptIn without contacting IDRS', async ({ body }) => {
      const res = await put(tenantB.code, body);

      expect(res.status).toBe(400);
      expect(await optIns()).toEqual([]);
      expect(verifyAccess).not.toHaveBeenCalled();
    });

    it.each([
      { case: 'an unknown tenant', tenantCode: 'no-such-tenant' },
      { case: "another partner's tenant", tenantCode: tenantC.code },
    ])('returns 404 for $case without contacting IDRS', async ({ tenantCode }) => {
      const res = await put(tenantCode, { fuzzyOptIn: true });

      expect(res.status).toBe(404);
      expect(await optIns()).toEqual([]);
      expect(verifyAccess).not.toHaveBeenCalled();
    });

    it("keeps an opt-in when the partner's mode changes to fuzzy and back", async () => {
      const optIn = await global.prisma.tenantFuzzyOptIn.create({
        data: { tenantCode: tenantB.code, partnerId: partnerA.id },
      });
      const saveConfig = (from: string, to: string) =>
        request(app.getHttpServer())
          .put('/partners/config')
          .set('Cookie', [adminCookieA])
          .send({
            crossYearMatchingEnabled: false,
            idMatchingMode: to,
            expected: { crossYearMatchingEnabled: false, idMatchingMode: from },
          });

      expect((await saveConfig('id_based', 'fuzzy')).status).toBe(200);
      expect(await optIns()).toEqual([optIn]);
      expect((await saveConfig('fuzzy', 'id_based')).status).toBe(200);
      expect(await optIns()).toEqual([optIn]);
    });
  });
});
