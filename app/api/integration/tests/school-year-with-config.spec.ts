import { userA, userB, userX } from '../fixtures/user-fixtures';
import { tenantA, tenantB, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import request from 'supertest';
import { authHelper } from '../helpers/oidc/auth-flow';
import { idpA, idpX } from '../fixtures/context-fixtures/idp-fixtures';

describe('GET /school-years/config', () => {
  const endpoint = '/school-years/config';
  const userRoleA = 'runway.test.user';

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;

    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA, userRoleA)).cookies;
    });

    it('should allow requests from user role (read access drives year selection)', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);
      expect(res.status).toBe(200);
    });

    it('should return all school years sorted by startYear descending', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0].startYear).toBe(2025);
      expect(res.body[1].startYear).toBe(2024);
      expect(res.body[2].startYear).toBe(2023);
    });

    it('should return config values from school_year_config when rows exist, defaults otherwise', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      // Partner A has config rows for 2425 and 2526 (seeded as enabled)
      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.isEnabled).toBe(true);
      expect(row2425.sendToOds).toBe(true);

      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.isEnabled).toBe(true);
      expect(row2526.sendToOds).toBe(true);

      // 2324 has no config row for partner A → defaults
      const row2324 = res.body.find((r: any) => r.schoolYearId === '2324');
      expect(row2324.isEnabled).toBe(false);
      expect(row2324.sendToOds).toBe(true);
    });

    it('should return hasOds=true only when the querying tenant has an active ODS for that year', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      // Tenant A has ODS for 2425 and 2526
      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.hasOds).toBe(true);

      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.hasOds).toBe(true);

      // No ODS for 2324
      const row2324 = res.body.find((r: any) => r.schoolYearId === '2324');
      expect(row2324.hasOds).toBe(false);
    });

    it('should scope hasOds to tenant — a different tenants ODS does not set hasOds=true', async () => {
      // Tenant B (same partner A) only has ODS for 2526, not 2425
      const cookieB = (await authHelper.login(idpA, userB, tenantB, userRoleA)).cookies;
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieB]);

      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.hasOds).toBe(false); // tenant A has it, but tenant B does not

      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.hasOds).toBe(true);
    });

    it('should return config scoped to the session partner', async () => {
      // Partner X has config for 2425 only
      const userRoleX = 'Runway.User';
      const cookieX = (await authHelper.login(idpX, userX, tenantX, userRoleX)).cookies;
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieX]);

      expect(res.body).toHaveLength(3);

      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.isEnabled).toBe(true);
      expect(row2425.hasOds).toBe(true);

      // 2526 and 2324 should be defaults for partner X
      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.isEnabled).toBe(false);
      expect(row2526.hasOds).toBe(false);

      const row2324 = res.body.find((r: any) => r.schoolYearId === '2324');
      expect(row2324.isEnabled).toBe(false);
      expect(row2324.hasOds).toBe(false);
    });

    it('should return schoolYearId, startYear, endYear on each row', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);
      const row = res.body[0];
      expect(row).toHaveProperty('schoolYearId');
      expect(row).toHaveProperty('startYear');
      expect(row).toHaveProperty('endYear');
      expect(row).toHaveProperty('isEnabled');
      expect(row).toHaveProperty('sendToOds');
      expect(row).toHaveProperty('hasOds');
    });
  });
});
