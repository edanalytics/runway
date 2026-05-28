import request from 'supertest';
import { userA } from '../fixtures/user-fixtures';
import { tenantA } from '../fixtures/context-fixtures/tenant-fixtures';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
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
  });
});
