import request from 'supertest';
import { userA, userX } from '../fixtures/user-fixtures';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { idpA, idpX } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
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
      canConnectSpy = jest
        .spyOn(app.get(EduSnowflakePoolService), 'canConnect')
        .mockResolvedValue(false);
    });

    afterEach(() => {
      canConnectSpy.mockRestore();
    });

    it('reflects the cross_year_matching_enabled column', async () => {
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: false },
      });
      let res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [adminCookieA]);
      expect(res.status).toBe(200);
      expect(res.body.crossYearMatchingEnabled).toBe(false);

      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: true },
      });
      res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [adminCookieA]);
      expect(res.body.crossYearMatchingEnabled).toBe(true);
    });

    it('reflects canConnect for eduCredsExist', async () => {
      canConnectSpy.mockResolvedValue(true);
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [adminCookieA]);
      expect(res.status).toBe(200);
      expect(res.body.eduCredsExist).toBe(true);
      expect(canConnectSpy).toHaveBeenCalledWith(partnerA.id);
    });

    it('returns eduCredsExist=false when canConnect is false', async () => {
      canConnectSpy.mockResolvedValue(false);
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [adminCookieA]);
      expect(res.body.eduCredsExist).toBe(false);
    });

    it('returns exactly { crossYearMatchingEnabled, eduCredsExist } and nothing else', async () => {
      canConnectSpy.mockResolvedValue(true);
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: true },
      });
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [adminCookieA]);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ crossYearMatchingEnabled: true, eduCredsExist: true });
    });
  });
});

describe('PUT /partners/config', () => {
  const endpoint = '/partners/config';
  const userRoleA = 'runway.test.user';
  const partnerAdminRoleA = 'runway.test.partneradmin';
  const partnerAdminRoleX = 'Runway.PartnerAdmin';

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer())
      .put(endpoint)
      .send({ crossYearMatchingEnabled: true });
    expect(res.status).toBe(401);
  });

  it('should reject non-PartnerAdmin users', async () => {
    const cookieA = (await authHelper.login(idpA, userA, tenantA, userRoleA)).cookies;
    const res = await request(app.getHttpServer())
      .put(endpoint)
      .set('Cookie', [cookieA])
      .send({ crossYearMatchingEnabled: true });
    expect(res.status).toBe(403);
  });

  describe('as PartnerAdmin', () => {
    let adminCookieA: string;
    let canConnectSpy: jest.SpyInstance;

    beforeEach(async () => {
      adminCookieA = (await authHelper.login(idpA, userA, tenantA, partnerAdminRoleA)).cookies;
      canConnectSpy = jest
        .spyOn(app.get(EduSnowflakePoolService), 'canConnect')
        .mockResolvedValue(true);
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: false },
      });
    });

    afterEach(() => {
      canConnectSpy.mockRestore();
    });

    it('updates cross_year_matching_enabled on the partner row', async () => {
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [adminCookieA])
        .send({ crossYearMatchingEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });

      const row = await global.prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } });
      expect(row.crossYearMatchingEnabled).toBe(true);
    });

    it('subsequent GET reflects the new value', async () => {
      await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [adminCookieA])
        .send({ crossYearMatchingEnabled: true });

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [adminCookieA]);
      expect(res.body.crossYearMatchingEnabled).toBe(true);
    });

    it('rejects enabling when EDU creds are missing', async () => {
      canConnectSpy.mockResolvedValue(false);
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [adminCookieA])
        .send({ crossYearMatchingEnabled: true });
      expect(res.status).toBe(400);

      const row = await global.prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } });
      expect(row.crossYearMatchingEnabled).toBe(false);
    });

    it('allows disabling even when EDU creds are missing', async () => {
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: true },
      });
      canConnectSpy.mockResolvedValue(false);

      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [adminCookieA])
        .send({ crossYearMatchingEnabled: false });
      expect(res.status).toBe(200);

      const row = await global.prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } });
      expect(row.crossYearMatchingEnabled).toBe(false);
    });

    it('only modifies the session partner', async () => {
      const adminCookieX = (await authHelper.login(idpX, userX, tenantX, partnerAdminRoleX)).cookies;
      await global.prisma.partner.update({
        where: { id: 'partner-x' },
        data: { crossYearMatchingEnabled: false },
      });

      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [adminCookieX])
        .send({ crossYearMatchingEnabled: true });
      expect(res.status).toBe(200);

      const partnerXRow = await global.prisma.partner.findUniqueOrThrow({
        where: { id: 'partner-x' },
      });
      expect(partnerXRow.crossYearMatchingEnabled).toBe(true);

      const partnerARow = await global.prisma.partner.findUniqueOrThrow({
        where: { id: partnerA.id },
      });
      expect(partnerARow.crossYearMatchingEnabled).toBe(false);
    });

    it('rejects invalid body', async () => {
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [adminCookieA])
        .send({ crossYearMatchingEnabled: 'nope' });
      expect(res.status).toBe(400);
    });
  });
});
