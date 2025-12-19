import request from 'supertest';
import { userA, userB } from '../fixtures/user-fixtures';
import { tenantA, tenantB } from '../fixtures/context-fixtures/tenant-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { GetOdsConfigDto } from 'models/src/dtos/ods-config.dto';
import {
  odsConfigA2425,
  odsConfigA2526,
  odsConfigB2526,
} from '../fixtures/context-fixtures/ods-fixture';

describe('GET /ods-configs', () => {
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get('/ods-configs');
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    let cookieB: string;
    const expectedOdsA = [odsConfigA2425, odsConfigA2526];
    const expectedOdsB = [odsConfigB2526];

    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
      cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
    });

    afterEach(async () => {
      await authHelper.logout(cookieA);
      await authHelper.logout(cookieB);
    });

    it('should return a list of ods configs for the tenant', async () => {
      const resA = await request(app.getHttpServer()).get('/ods-configs').set('Cookie', [cookieA]);
      const resB = await request(app.getHttpServer()).get('/ods-configs').set('Cookie', [cookieB]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      expect(resA.body.length).toBe(expectedOdsA.length);
      expect(resB.body.length).toBe(expectedOdsB.length);

      const resAIds = resA.body.map((o: GetOdsConfigDto) => o.id);
      expect(resAIds).toEqual(expect.arrayContaining(expectedOdsA.map((o) => o.id)));

      const resBIds = resB.body.map((o: GetOdsConfigDto) => o.id);
      expect(resBIds).toEqual(expect.arrayContaining(expectedOdsB.map((o) => o.id)));
    });
  });
});

describe('GET /ods-configs/:id', () => {
  const endpointA = `/ods-configs/${odsConfigA2425.id}`;
  const endpointB = `/ods-configs/${odsConfigB2526.id}`;
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpointA);
    expect(res.status).toBe(401);
  });
  describe('authenticated requests', () => {
    let cookieA: string;
    let cookieB: string;
    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
      cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
    });

    afterEach(async () => {
      await authHelper.logout(cookieA);
      await authHelper.logout(cookieB);
    });

    it('should return the ods config if the user is logged into the associated tenant', async () => {
      const resA = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieA]);
      const resB = await request(app.getHttpServer()).get(endpointB).set('Cookie', [cookieB]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
    });

    it('should reject requests for ODS configs that are not associated with the tenant', async () => {
      // user A requests ODS config B, user B requests ODS config A
      const res1 = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieB]);
      const res2 = await request(app.getHttpServer()).get(endpointB).set('Cookie', [cookieA]);
      expect(res1.status).toBe(403);
      expect(res2.status).toBe(403);
    });
  });
});
