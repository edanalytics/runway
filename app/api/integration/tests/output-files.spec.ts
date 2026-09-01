import request from 'supertest';
import {
  tenantA,
  tenantB,
  tenantDGlobal,
  tenantEGlobal,
} from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB } from '../fixtures/user-fixtures';
import { odsConfigA2425, odsConfigB2526 } from '../fixtures/context-fixtures/ods-fixture';
import { bundleA } from '../fixtures/em-bundle-fixtures';
import { seedJob } from '../factories/job-factory';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { DtoableJob } from 'models/src/dtos/job.dto';

const SUPPORT_ROLES = ['runway.test.user', 'runway.test.supportuser'];
const USER_ROLE = 'runway.test.user';

describe('GET /output-files/:jobId', () => {
  let endpointA: string;
  let endpointB: string;
  let jobA: DtoableJob;
  let jobB: DtoableJob;
  let jobEGlobal: DtoableJob;

  beforeEach(async () => {
    [jobA, jobB, jobEGlobal] = await Promise.all([
      seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
        outputFiles: true,
      }),
      seedJob({
        odsConfig: odsConfigB2526,
        bundle: bundleA,
        tenant: tenantB,
        outputFiles: true,
      }),
      seedJob({
        odsConfig: odsConfigA2425, // same partner as tenantA/tenantB is fine
        bundle: bundleA,
        tenant: tenantEGlobal,
        outputFiles: true,
      }),
    ]);
    endpointA = `/output-files/${jobA.id}`;
    endpointB = `/output-files/${jobB.id}`;
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpointA);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    let cookieB: string;
    let nonSupportCookieA: string;
    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA, SUPPORT_ROLES)).cookies;
      cookieB = (await authHelper.login(idpA, userB, tenantB, SUPPORT_ROLES)).cookies;
      nonSupportCookieA = (await authHelper.login(idpA, userA, tenantA, USER_ROLE)).cookies;
    });

    it('should return the output files for a job owned by the tenant, for a SupportUser', async () => {
      const res = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieA]);

      expect(res.status).toBe(200);
      const expectedFiles = jobA.runs?.flatMap((r) => r.runOutputFile ?? []) ?? [];
      expect(res.body.map((f: { name: string }) => f.name)).toEqual(
        expect.arrayContaining(expectedFiles.map((f) => f.name))
      );
    });

    it('should reject requests from a user without the SupportUser role, even for their own tenant', async () => {
      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Cookie', [nonSupportCookieA]);
      expect(res.status).toBe(403);
    });

    it('should reject requests for jobs that are not associated with the tenant', async () => {
      const resA = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieB]);
      const resB = await request(app.getHttpServer()).get(endpointB).set('Cookie', [cookieA]);
      expect(resA.status).toBe(403);
      expect(resB.status).toBe(403);
    });

    it('should return 404 for a job that does not exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/output-files/999999999')
        .set('Cookie', [cookieA]);
      expect(res.status).toBe(404);
    });

    describe('metatenant access (route has @AllowMetatenant)', () => {
      it.each([
        {
          description:
            'global session tenant + non-global resource tenant (same partner) + metatenant privilege -> allowed',
          sessionTenant: tenantDGlobal,
          resourceJob: () => jobB,
          roles: SUPPORT_ROLES,
          expectedStatus: 200,
        },
        {
          description:
            'global session tenant + non-global resource tenant (same partner) + no metatenant privilege -> forbidden',
          sessionTenant: tenantDGlobal,
          resourceJob: () => jobB,
          roles: USER_ROLE,
          expectedStatus: 403,
        },
        {
          description:
            'global session tenant + resource owned by a different global tenant + metatenant privilege -> forbidden',
          sessionTenant: tenantDGlobal,
          resourceJob: () => jobEGlobal,
          roles: SUPPORT_ROLES,
          expectedStatus: 403,
        },
        {
          description:
            'non-global session tenant + non-global resource tenant (same partner) + metatenant privilege -> forbidden',
          sessionTenant: tenantA,
          resourceJob: () => jobB,
          roles: SUPPORT_ROLES,
          expectedStatus: 403,
        },
      ])('$description', async ({ sessionTenant, resourceJob, roles, expectedStatus }) => {
        const cookie = (await authHelper.login(idpA, userA, sessionTenant, roles)).cookies;

        const res = await request(app.getHttpServer())
          .get(`/output-files/${resourceJob().id}`)
          .set('Cookie', [cookie]);

        expect(res.status).toBe(expectedStatus);
      });

      it('should return the output files for a job owned by a different tenant when the user is a SupportUser logged into a global tenant in the same partner', async () => {
        const cookie = (await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_ROLES)).cookies;

        const res = await request(app.getHttpServer())
          .get(endpointB)
          .set('Cookie', [cookie]);

        expect(res.status).toBe(200);
        const expectedFiles = jobB.runs?.flatMap((r) => r.runOutputFile ?? []) ?? [];
        expect(res.body.map((f: { name: string }) => f.name)).toEqual(
          expect.arrayContaining(expectedFiles.map((f) => f.name))
        );
      });
    });
  });
});
