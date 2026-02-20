import { sessionData } from '../helpers/session/session-factory';
import { userA, userX } from '../fixtures/user-fixtures';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import {
  partnerABundles,
  partnerXBundles,
  allBundles,
  bundleM,
} from '../fixtures/em-bundle-fixtures';
import { sessionCookie } from '../helpers/session/session-cookie';
import sessionStore from '../helpers/session/session-store';
import request from 'supertest';
import { EarthbeamBundlesService } from 'api/src/earthbeam/earthbeam-bundles.service';
import { map } from 'lodash';
import {
  makePartnerUserTenantContext,
  seedContext,
} from '../factories/partner-user-tenant';
import { partnerA, partnerX } from '../fixtures/context-fixtures/partner-fixtures';

describe('GET /job-templates', () => {
  const endpoint = '/job-templates/assessments';
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    const sessA = sessionCookie('job-templates-spec-a');
    const sessX = sessionCookie('job-templates-spec-x');

    // M is a partner that has no bundles yet
    const sessM = sessionCookie('job-templates-spec-m');
    let contextM: Awaited<ReturnType<typeof seedContext>>;
    let getBundlesMock: jest.SpyInstance;

    beforeEach(async () => {
      contextM = await seedContext(makePartnerUserTenantContext('m'));
      getBundlesMock = jest
        .spyOn(EarthbeamBundlesService.prototype, 'getBundles')
        .mockResolvedValue(allBundles);
      await sessionStore.set(sessA.sid, sessionData(userA, tenantA));
      await sessionStore.set(sessX.sid, sessionData(userX, tenantX));
      await sessionStore.set(sessM.sid, sessionData(contextM.user, contextM.tenant));
    });

    afterEach(async () => {
      await sessionStore.destroy(sessA.sid);
      await sessionStore.destroy(sessX.sid);
      await sessionStore.destroy(sessM.sid);
      getBundlesMock.mockRestore();
    });

    it('should return no bundles if none are enabled for the partner', async () => {
      // X has no bundles yet, but A does
      const resA = await request(app.getHttpServer()).get(endpoint).set('Cookie', [sessA.cookie]);
      const resM = await request(app.getHttpServer()).get(endpoint).set('Cookie', [sessM.cookie]);

      expect(resA.status).toBe(200);
      expect(resM.status).toBe(200);

      expect(map(resA.body, 'path')).toEqual(map(partnerABundles, 'path'));
      expect(map(resM.body, 'path')).toEqual([]);
    });

    it('should return only bundles that are enabled for each partner', async () => {
      // let's give everyone access to bundle M
      await prisma.partnerEarthmoverBundle.createMany({
        data: [partnerA, partnerX, contextM.partner].map((p) => ({
          partnerId: p.id,
          earthmoverBundleKey: bundleM.path,
        })),
      });

      const resA = await request(app.getHttpServer()).get(endpoint).set('Cookie', [sessA.cookie]);
      const resX = await request(app.getHttpServer()).get(endpoint).set('Cookie', [sessX.cookie]);
      const resM = await request(app.getHttpServer()).get(endpoint).set('Cookie', [sessM.cookie]);

      expect(resA.status).toBe(200);
      expect(resX.status).toBe(200);
      expect(resM.status).toBe(200);

      expect(map(resA.body, 'path')).toEqual(map([...partnerABundles, bundleM], 'path'));
      expect(map(resX.body, 'path')).toEqual(map([...partnerXBundles, bundleM], 'path'));
      expect(map(resM.body, 'path')).toEqual(map([bundleM], 'path'));
    });

    it('should not error if there are no input params', async () => {
      getBundlesMock.mockResolvedValue(
        partnerABundles.map((b) => {
          const { input_params, ...bundleSansParams } = b;
          return bundleSansParams;
        })
      );
      const resA = await request(app.getHttpServer()).get(endpoint).set('Cookie', [sessA.cookie]);
      expect(resA.status).toBe(200);
      expect(resA.body).toHaveLength(partnerABundles.length);
    });
  });
});
