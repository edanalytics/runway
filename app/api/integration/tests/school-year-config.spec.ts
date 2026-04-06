import { userA, userB, userX } from '../fixtures/user-fixtures';
import { tenantA, tenantB, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { partnerA, partnerX } from '../fixtures/context-fixtures/partner-fixtures';
import request from 'supertest';
import { authHelper } from '../helpers/oidc/auth-flow';
import { idpA, idpX } from '../fixtures/context-fixtures/idp-fixtures';
import { FileService } from 'api/src/files/file.service';

const ETAG_HEADER = 'etag';
const IF_MATCH_HEADER = 'if-match';

describe('GET /school-year-config', () => {
  const endpoint = '/school-year-config';
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

    it('should allow requests from user role because read access drives year selection', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);
      expect(res.status).toBe(200);
    });

    it('should return 200 with config rows for all school years', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3); // 3 school years
    });

    it('should return correct config values — seeded rows enabled, others default', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      // Partner A has ODS configs for 2425 and 2526 (seeded as enabled)
      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.isEnabled).toBe(true);
      expect(row2425.sendToOds).toBe(true);

      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.isEnabled).toBe(true);
      expect(row2526.sendToOds).toBe(true);

      // 2324 has no ODS config for partner A → defaults
      const row2324 = res.body.find((r: any) => r.schoolYearId === '2324');
      expect(row2324.isEnabled).toBe(false);
      expect(row2324.sendToOds).toBe(true);
    });

    it('should return ODS count per school year', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      // Partner A: tenant-a has ODS for 2425 and 2526, tenant-b has ODS for 2526
      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.odsCount).toBe(1);

      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.odsCount).toBe(2);

      const row2324 = res.body.find((r: any) => r.schoolYearId === '2324');
      expect(row2324.odsCount).toBe(0);
    });

    it('should include ETag header when config rows exist', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      expect(res.headers[ETAG_HEADER]).toBeDefined();
    });

    it('should only return config for the session partner, not other partners', async () => {
      const userRoleX = 'Runway.User';
      const cookieX = (await authHelper.login(idpX, userX, tenantX, userRoleX)).cookies;
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieX]);

      // Partner X only has ODS for 2425
      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.isEnabled).toBe(true);

      // 2526 and 2324 should be defaults for partner X
      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.isEnabled).toBe(false);

      const row2324 = res.body.find((r: any) => r.schoolYearId === '2324');
      expect(row2324.isEnabled).toBe(false);
    });
  });
});

describe('PUT /school-year-config', () => {
  const endpoint = '/school-year-config';
  const userRoleA = 'runway.test.user';
  const partnerAdminRoleA = 'runway.test.partneradmin';
  const partnerAdminRoleX = 'Runway.PartnerAdmin';

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).put(endpoint).send({});
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;

    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA, userRoleA)).cookies;
    });

    it('should reject requests from user without PartnerAdmin role', async () => {
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [cookieA])
        .send([]);
      expect(res.status).toBe(403);
    });

    describe('as PartnerAdmin', () => {
      let partnerAdminCookieA: string;

      beforeEach(async () => {
        partnerAdminCookieA = (await authHelper.login(idpA, userA, tenantA, partnerAdminRoleA))
          .cookies;
      });

      function getEtag(res: request.Response): string | null {
        return res.headers[ETAG_HEADER] ?? null;
      }

      it('should update config for multiple years in one call', async () => {
        // First get the current ETag
        const getRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [partnerAdminCookieA]);
        const etag = getEtag(getRes);

        const req = request(app.getHttpServer()).put(endpoint).set('Cookie', [partnerAdminCookieA]);
        if (etag) req.set(IF_MATCH_HEADER, etag);
        const res = await req.send([
          { schoolYearId: '2425', isEnabled: false, sendToOds: false },
          { schoolYearId: '2526', isEnabled: true, sendToOds: false },
        ]);
        expect(res.status).toBe(200);

        // Verify the changes persisted
        const verifyRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [partnerAdminCookieA]);
        const row2425 = verifyRes.body.find((r: any) => r.schoolYearId === '2425');
        expect(row2425.isEnabled).toBe(false);
        expect(row2425.sendToOds).toBe(false);

        const row2526 = verifyRes.body.find((r: any) => r.schoolYearId === '2526');
        expect(row2526.isEnabled).toBe(true);
        expect(row2526.sendToOds).toBe(false);
      });

      it('should upsert — create config rows for years that had no row', async () => {
        const getRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [partnerAdminCookieA]);
        const etag = getEtag(getRes);

        // 2324 has no existing config row for partner A
        const req = request(app.getHttpServer()).put(endpoint).set('Cookie', [partnerAdminCookieA]);
        if (etag) req.set(IF_MATCH_HEADER, etag);
        const res = await req.send([{ schoolYearId: '2324', isEnabled: true, sendToOds: true }]);
        expect(res.status).toBe(200);

        const verifyRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [partnerAdminCookieA]);
        const row2324 = verifyRes.body.find((r: any) => r.schoolYearId === '2324');
        expect(row2324.isEnabled).toBe(true);
      });

      it('should return 409 with last modifier info when ETag does not match', async () => {
        const staleEtag = '"2020-01-01T00:00:00.000Z"';
        const res = await request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [partnerAdminCookieA])
          .set(IF_MATCH_HEADER, staleEtag)
          .send([{ schoolYearId: '2425', isEnabled: false, sendToOds: false }]);
        expect(res.status).toBe(409);
        expect(res.body.etag).toBeDefined();
        expect(res.body.lastModifiedOn).toBeDefined();
      });

      it('should return 409 when If-Match is missing and config rows already exist', async () => {
        const res = await request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [partnerAdminCookieA])
          .send([{ schoolYearId: '2425', isEnabled: false, sendToOds: false }]);
        expect(res.status).toBe(409);
        expect(res.body.etag).toBeDefined();
        expect(res.body.lastModifiedOn).toBeDefined();
      });

      it('should succeed when ETag is absent and no config rows exist', async () => {
        const partnerAdminCookieX = (
          await authHelper.login(idpX, userX, tenantX, partnerAdminRoleX)
        ).cookies;
        // Partner X: delete its config row to simulate a fresh partner
        await global.prisma.schoolYearConfig.deleteMany({
          where: { partnerId: partnerX.id },
        });

        const res = await request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [partnerAdminCookieX])
          .send([{ schoolYearId: '2425', isEnabled: true, sendToOds: true }]);
        expect(res.status).toBe(200);
      });

      it('should not modify other partners config', async () => {
        const partnerAdminCookieA = (
          await authHelper.login(idpA, userA, tenantA, partnerAdminRoleA)
        ).cookies;
        const partnerAdminCookieX = (
          await authHelper.login(idpX, userX, tenantX, partnerAdminRoleX)
        ).cookies;
        const getRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [partnerAdminCookieA]);
        const etag = getEtag(getRes);

        const req = request(app.getHttpServer()).put(endpoint).set('Cookie', [partnerAdminCookieA]);
        if (etag) req.set(IF_MATCH_HEADER, etag);
        await req.send([{ schoolYearId: '2425', isEnabled: false, sendToOds: false }]);

        // Partner X config should be unchanged
        const verifyRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [partnerAdminCookieX]);
        const xRow2425 = verifyRes.body.find((r: any) => r.schoolYearId === '2425');
        expect(xRow2425.isEnabled).toBe(true); // still the original seeded value
      });

      it('should return 400 for invalid school year IDs', async () => {
        const getRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [partnerAdminCookieA]);
        const etag = getEtag(getRes);

        const req = request(app.getHttpServer()).put(endpoint).set('Cookie', [partnerAdminCookieA]);
        if (etag) req.set(IF_MATCH_HEADER, etag);
        const res = await req.send([
          { schoolYearId: 'nonexistent', isEnabled: true, sendToOds: true },
        ]);
        expect(res.status).toBe(400);
      });
    });
  });
});

describe('GET /school-year-config/tenant', () => {
  const endpoint = '/school-year-config/tenant';
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

    it('should return only enabled school years', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);
      expect(res.status).toBe(200);

      // Partner A has 2425 and 2526 enabled; 2324 has no config row (not enabled)
      expect(res.body).toHaveLength(2);
      const yearIds = res.body.map((r: any) => r.schoolYearId);
      expect(yearIds).toContain('2425');
      expect(yearIds).toContain('2526');
      expect(yearIds).not.toContain('2324');
    });

    it('should include sendToOds config per year', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.sendToOds).toBe(true);
    });

    it('should indicate whether the tenant has an active ODS for each year', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      // Tenant A has ODS for 2425 and 2526
      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.hasOds).toBe(true);

      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.hasOds).toBe(true);
    });

    it('should return hasOds=false when tenant has no ODS for an enabled year', async () => {
      // Enable 2324 for partner A but don't create an ODS for it
      await global.prisma.schoolYearConfig.create({
        data: { partnerId: partnerA.id, schoolYearId: '2324', isEnabled: true, sendToOds: true },
      });

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      const row2324 = res.body.find((r: any) => r.schoolYearId === '2324');
      expect(row2324).toBeDefined();
      expect(row2324.hasOds).toBe(false);
    });

    it('should scope ODS availability to the session tenant, not the whole partner', async () => {
      // Tenant B (same partner A) has ODS for 2526 but not 2425
      const cookieB = (await authHelper.login(idpA, userB, tenantB, userRoleA)).cookies;
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieB]);

      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.hasOds).toBe(false); // tenant B has no ODS for 2425

      const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
      expect(row2526.hasOds).toBe(true); // tenant B has ODS for 2526
    });

    it('should include school year display fields', async () => {
      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.startYear).toBe(2024);
      expect(row2425.endYear).toBe(2025);
    });

    it('should return hasRoster=null for send-to-ODS years without checking S3', async () => {
      const doFilesExistMock = app.get(FileService).doFilesExist as jest.Mock;

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.hasRoster).toBeNull();
      expect(doFilesExistMock).not.toHaveBeenCalled();
    });

    it('should return hasRoster=true when a no-ODS roster file exists', async () => {
      await global.prisma.schoolYearConfig.update({
        where: {
          partnerId_schoolYearId: { partnerId: partnerA.id, schoolYearId: '2425' },
        },
        data: { sendToOds: false },
      });

      const doFilesExistMock = app.get(FileService).doFilesExist as jest.Mock;
      doFilesExistMock.mockResolvedValue(true);

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

      const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
      expect(row2425.hasRoster).toBe(true);
    });

    it('should return hasRoster=false when a no-ODS roster file does not exist', async () => {
      await global.prisma.schoolYearConfig.update({
        where: {
          partnerId_schoolYearId: { partnerId: partnerA.id, schoolYearId: '2425' },
        },
        data: { sendToOds: false },
      });

      const doFilesExistMock = app.get(FileService).doFilesExist as jest.Mock;
      doFilesExistMock.mockResolvedValue(false);

      try {
        const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookieA]);

        const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
        expect(row2425.hasRoster).toBe(false);
      } finally {
        doFilesExistMock.mockResolvedValue(true);
      }
    });
  });
});
