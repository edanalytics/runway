import { sessionData } from '../helpers/session/session-factory';
import { sessionCookie } from '../helpers/session/session-cookie';
import sessionStore from '../helpers/session/session-store';
import { userA, userX } from '../fixtures/user-fixtures';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { partnerX } from '../fixtures/context-fixtures/partner-fixtures';
import request from 'supertest';
import { SessionData } from 'express-session';

const ETAG_HEADER = 'etag';
const IF_MATCH_HEADER = 'if-match';

describe('GET /school-year-config', () => {
  const endpoint = '/school-year-config';

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    const sessA = sessionCookie('syc-get-a');
    const sessX = sessionCookie('syc-get-x');

    beforeEach(async () => {
      await sessionStore.set(sessA.sid, sessionData(userA, tenantA));
      await sessionStore.set(sessX.sid, sessionData(userX, tenantX));
    });

    it('should reject requests from user without PartnerAdmin role', async () => {
      const res = await request(app.getHttpServer())
        .get(endpoint)
        .set('Cookie', [sessA.cookie]);
      expect(res.status).toBe(403);
    });

    describe('as PartnerAdmin', () => {
      beforeEach(async () => {
        // Grant PartnerAdmin to userA
        const session = await sessionStore.get(sessA.sid);
        session!.passport!.user.roles.push('PartnerAdmin');
        await sessionStore.set(sessA.sid, session as SessionData);

        // Grant PartnerAdmin to userX
        const sessionX = await sessionStore.get(sessX.sid);
        sessionX!.passport!.user.roles.push('PartnerAdmin');
        await sessionStore.set(sessX.sid, sessionX as SessionData);
      });

      it('should return 200 with config rows for all school years', async () => {
        const res = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(3); // 3 school years
      });

      it('should return correct config values — seeded rows enabled, others default', async () => {
        const res = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);

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

      it('should include school year info in each row', async () => {
        const res = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);

        const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
        expect(row2425.startYear).toBe(2024);
        expect(row2425.endYear).toBe(2025);
      });

      it('should return ODS count per school year', async () => {
        const res = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);

        // Partner A: tenant-a has ODS for 2425 and 2526, tenant-b has ODS for 2526
        const row2425 = res.body.find((r: any) => r.schoolYearId === '2425');
        expect(row2425.odsCount).toBe(1);

        const row2526 = res.body.find((r: any) => r.schoolYearId === '2526');
        expect(row2526.odsCount).toBe(2);

        const row2324 = res.body.find((r: any) => r.schoolYearId === '2324');
        expect(row2324.odsCount).toBe(0);
      });

      it('should include ETag header when config rows exist', async () => {
        const res = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);

        expect(res.headers[ETAG_HEADER]).toBeDefined();
        expect(res.body[0]).not.toHaveProperty('modifiedOn');
      });

      it('should only return config for the session partner, not other partners', async () => {
        const res = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessX.cookie]);

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
});

describe('PUT /school-year-config', () => {
  const endpoint = '/school-year-config';

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).put(endpoint).send({});
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    const sessA = sessionCookie('syc-put-a');
    const sessX = sessionCookie('syc-put-x');

    beforeEach(async () => {
      await sessionStore.set(sessA.sid, sessionData(userA, tenantA));
      await sessionStore.set(sessX.sid, sessionData(userX, tenantX));
    });

    it('should reject requests from user without PartnerAdmin role', async () => {
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [sessA.cookie])
        .send([]);
      expect(res.status).toBe(403);
    });

    describe('as PartnerAdmin', () => {
      beforeEach(async () => {
        const session = await sessionStore.get(sessA.sid);
        session!.passport!.user.roles.push('PartnerAdmin');
        await sessionStore.set(sessA.sid, session as SessionData);

        const sessionX = await sessionStore.get(sessX.sid);
        sessionX!.passport!.user.roles.push('PartnerAdmin');
        await sessionStore.set(sessX.sid, sessionX as SessionData);
      });

      function getEtag(res: request.Response): string | null {
        return res.headers[ETAG_HEADER] ?? null;
      }

      it('should update config for multiple years in one call', async () => {
        // First get the current ETag
        const getRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);
        const etag = getEtag(getRes);

        const req = request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [sessA.cookie]);
        if (etag) req.set(IF_MATCH_HEADER, etag);
        const res = await req.send([
          { schoolYearId: '2425', isEnabled: false, sendToOds: false },
          { schoolYearId: '2526', isEnabled: true, sendToOds: false },
        ]);
        expect(res.status).toBe(200);

        // Verify the changes persisted
        const verifyRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);
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
          .set('Cookie', [sessA.cookie]);
        const etag = getEtag(getRes);

        // 2324 has no existing config row for partner A
        const req = request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [sessA.cookie]);
        if (etag) req.set(IF_MATCH_HEADER, etag);
        const res = await req.send([{ schoolYearId: '2324', isEnabled: true, sendToOds: true }]);
        expect(res.status).toBe(200);

        const verifyRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);
        const row2324 = verifyRes.body.find((r: any) => r.schoolYearId === '2324');
        expect(row2324.isEnabled).toBe(true);
      });

      it('should return 409 when ETag does not match (stale data)', async () => {
        const staleEtag = '"2020-01-01T00:00:00.000Z"';
        const res = await request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [sessA.cookie])
          .set(IF_MATCH_HEADER, staleEtag)
          .send([{ schoolYearId: '2425', isEnabled: false, sendToOds: false }]);
        expect(res.status).toBe(409);
      });

      it('should include last modifier info in 409 response', async () => {
        const staleEtag = '"2020-01-01T00:00:00.000Z"';
        const res = await request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [sessA.cookie])
          .set(IF_MATCH_HEADER, staleEtag)
          .send([{ schoolYearId: '2425', isEnabled: false, sendToOds: false }]);
        expect(res.status).toBe(409);
        expect(res.body.etag).toBeDefined();
        expect(res.body.lastModifiedOn).toBeDefined();
      });

      it('should succeed when ETag is absent and no config rows exist', async () => {
        // Partner X: delete its config row to simulate a fresh partner
        await global.prisma.schoolYearConfig.deleteMany({
          where: { partnerId: partnerX.id },
        });

        const res = await request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [sessX.cookie])
          .send([{ schoolYearId: '2425', isEnabled: true, sendToOds: true }]);
        expect(res.status).toBe(200);
      });

      it('should not modify other partners config', async () => {
        const getRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);
        const etag = getEtag(getRes);

        const req = request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [sessA.cookie]);
        if (etag) req.set(IF_MATCH_HEADER, etag);
        await req.send([{ schoolYearId: '2425', isEnabled: false, sendToOds: false }]);

        // Partner X config should be unchanged
        const verifyRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessX.cookie]);
        const xRow2425 = verifyRes.body.find((r: any) => r.schoolYearId === '2425');
        expect(xRow2425.isEnabled).toBe(true); // still the original seeded value
      });

      it('should return 400 for invalid school year IDs', async () => {
        const getRes = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', [sessA.cookie]);
        const etag = getEtag(getRes);

        const req = request(app.getHttpServer())
          .put(endpoint)
          .set('Cookie', [sessA.cookie]);
        if (etag) req.set(IF_MATCH_HEADER, etag);
        const res = await req.send([{ schoolYearId: 'nonexistent', isEnabled: true, sendToOds: true }]);
        expect(res.status).toBe(400);
      });
    });
  });
});
