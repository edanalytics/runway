import { sessionData } from '../helpers/session/session-factory';
import { userA } from '../fixtures/user-fixtures';
import { tenantA } from '../fixtures/context-fixtures/tenant-fixtures';
import { allBundles } from '../fixtures/em-bundle-fixtures';
import { sessionCookie } from '../helpers/session/session-cookie';
import sessionStore from '../helpers/session/session-store';
import request from 'supertest';
import { EarthbeamBundlesService } from 'api/src/earthbeam/earthbeam-bundles.service';
import { SessionData } from 'express-session';

describe('POST /partners', () => {
  const endpoint = '/partners/assessments/test';
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).post(endpoint);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    const sessA = sessionCookie('partners-spec-a');

    beforeEach(async () => {
      jest.spyOn(EarthbeamBundlesService.prototype, 'getBundles').mockResolvedValue(allBundles);
      await sessionStore.set(sessA.sid, sessionData(userA, tenantA));
    });

    afterEach(async () => {
      await sessionStore.destroy(sessA.sid);
      await jest.restoreAllMocks();
    });

    it('should reject requests from user without the PartnerAdmin role', async () => {
      const resA = await request(app.getHttpServer())
        .post('/partners/assessments/test')
        .set('Cookie', [sessA.cookie]);
      expect(resA.status).toBe(403);
    });
    it('allow partner admins to call this route', async () => {
      const session = await sessionStore.get(sessA.sid);
      session?.passport?.user.roles.push('PartnerAdmin');
      await sessionStore.set(sessA.sid, session as SessionData);
      const resA = await request(app.getHttpServer())
        .post('/partners/assessments/test')
        .set('Cookie', [sessA.cookie]);
      expect(resA.status).toBe(201);
    });
  });
});
