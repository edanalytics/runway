import request from 'supertest';
import { signExternalApiToken } from '../helpers/external-api/token-helper';
import * as jose from 'jose';
import { EXTERNAL_API_SCOPE_KEY } from '../../src/external-api/auth/external-api-scope.decorator';
import { ExternalApiV1TokenController } from '../../src/external-api/v1/token.v1.controller';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { allBundles, bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import { EarthbeamBundlesService } from 'api/src/earthbeam/earthbeam-bundles.service';
import { schoolYear2324 } from '../fixtures/context-fixtures/school-year-fixtures';
import { odsConfigA2425, odsConnA2425 } from '../fixtures/context-fixtures/ods-fixture';
import { seedOds } from '../factories/ods-factory';
import { EarthbeamRunService } from 'api/src/earthbeam/earthbeam-run.service';
import { Job } from '@prisma/client';
import { FileService } from 'api/src/files/file.service';

describe('ExternalApiV1', () => {
  describe('Token Auth', () => {
    const endpoint = '/v1/token/verify';
    const scope = ['create:jobs', 'partner:partner-a'].join(' ');

    describe('Valid Token', () => {
      it('should return 201 if the token is valid', async () => {
        const token = await signExternalApiToken({ scope });
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(201);
      });
    });
    describe('Invalid Token', () => {
      it('should return 401 if there is no token', async () => {
        const res = await request(app.getHttpServer()).post(endpoint).set('Authorization', '');
        expect(res.status).toBe(401);
      });

      it('should return 401 if the payload is tampered with', async () => {
        const token = await signExternalApiToken({ scope });
        const [header, payload, signature] = token.split('.');
        const invalidPayload = {
          ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
          scope: 'create:jobs:invalid',
        };
        const invalidToken = `${header}.${Buffer.from(JSON.stringify(invalidPayload)).toString(
          'base64url'
        )}.${signature}`;
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${invalidToken}`);
        expect(res.status).toBe(401);
      });

      it('should return 401 if the token signature is invalid', async () => {
        const token = await signExternalApiToken({ scope });
        const [header, payload, signature] = token.split('.');
        const invalidToken = `${header}.${payload}.invalid`;
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${invalidToken}`);
        expect(res.status).toBe(401);
      });

      it('should return 401 if the token is not signed with the correct keys', async () => {
        const newKeyPair = await jose.generateKeyPair('RS256');
        const token = await signExternalApiToken(
          { scope },
          { privateKey: newKeyPair.privateKey } // signing the token with this new private key means it can't be verified with the public key jose is using
        );
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });

      it('should return 401 if the audience is invalid', async () => {
        const token = await signExternalApiToken({ scope }, { audience: 'invalid' });
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });
      it('should return 401 if the token is expired', async () => {
        const token = await signExternalApiToken({ scope }, { expiresIn: '-1s' }); // you can sign expired tokens!
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });
      it('should return 403 if required scope is missing', async () => {
        const token = await signExternalApiToken({
          scope: scope.replace('create:jobs', '').trim(),
        }); // no create:jobs scope
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });
      it('should return 403 if ANY required scope is missing', async () => {
        const token = await signExternalApiToken({ scope }); // has create:jobs but not read:jobs
        const originalScopes = Reflect.getMetadata(
          EXTERNAL_API_SCOPE_KEY,
          ExternalApiV1TokenController.prototype.verifyToken
        );
        try {
          Reflect.defineMetadata(
            EXTERNAL_API_SCOPE_KEY,
            ['create:jobs', 'read:jobs'], // require both
            ExternalApiV1TokenController.prototype.verifyToken
          );

          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(403);
        } finally {
          // restore original scopes
          Reflect.defineMetadata(
            EXTERNAL_API_SCOPE_KEY,
            originalScopes,
            ExternalApiV1TokenController.prototype.verifyToken
          );
        }
      });
      it('should return 403 if scopes are not included on the token', async () => {
        const token = await signExternalApiToken({});
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });
    });
  });

  describe('Jobs V1', () => {
    describe('POST /jobs', () => {
      const endpoint = '/v1/jobs';
      let getBundleMock: jest.SpyInstance;
      let jobInput: {
        partner: string;
        tenant: string;
        bundle: string;
        schoolYear: string;
        files: Record<string, string>;
        params: Record<string, string>;
      };

      beforeEach(() => {
        jobInput = {
          partner: partnerA.id,
          tenant: tenantA.code,
          bundle: bundleA.path,
          schoolYear: '2425',
          files: { INPUT_FILE: 'input-file.csv' },
          params: { FORMAT: 'Standard' },
        };
        getBundleMock = jest
          .spyOn(EarthbeamBundlesService.prototype, 'getBundles')
          .mockResolvedValue(allBundles);
      });

      afterEach(() => {
        getBundleMock.mockRestore();
      });

      describe('Valid Request', () => {
        it('should return a 201 and the job id', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          expect(res.status).toBe(201);
          expect(res.body.uid).toBeDefined();
          expect(res.body.uploadUrls).toHaveProperty('INPUT_FILE');
          expect(res.body.uploadUrls.INPUT_FILE).toContain(jobInput.files.INPUT_FILE); // FileService.getPresignedUploadUrl is mocked in init-app.ts
          expect(res.body.uploadUrls.INPUT_FILE).toContain('s3-test-upload-url://');
          await prisma.job.delete({
            where: { uid: res.body.uid },
          });
        });
      });
      describe('Invalid Request', () => {
        it('should reject requests without a partner scope', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          // this and other tests check the error message to ensure the test is
          // failing for the expected reason, not some other failure
          expect(res.status).toBe(403);
          expect(res.body.message).toContain('Invalid partner code');
        });
        it('should reject requests without the correct partner scope', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-b' }); // request is for partner-a
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);
          expect(res.status).toBe(403);
          expect(res.body.message).toContain('Invalid partner code');
        });

        it('should reject requests for tenants outside the scoped partner', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({ ...jobInput, tenant: tenantX.code }); // partner/tenant mismatch
          expect(res.status).toBe(403);
          expect(res.body.message).toContain('Invalid tenant code');
        });

        it('should reject requests for non-existent bundles', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              bundle: 'does-not-exist',
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Bundle not found');
        });

        it('should reject requests if the bundle is not enabled for the partner', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              bundle: bundleX.path,
            });

          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Bundle not enabled for partner');
        });

        it('should reject requests if an ODS is not found for the requested school year', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              schoolYear: schoolYear2324.id,
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('No ODS found');
        });

        it('should reject requests with an invalid school year format', async () => {
          // This test checks that we're hitting the class validator requirements in the DTO
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({ ...jobInput, schoolYear: '2025-2026' });
          expect(res.status).toBe(400);
          expect(res.body.message).toEqual(
            expect.arrayContaining([
              expect.stringContaining('School year must be 4 characters long'),
            ])
          );
        });

        it('should reject requests if multiple ODSs are found for the requested school year', async () => {
          const secondOds = await seedOds({
            config: { ...odsConfigA2425, id: odsConfigA2425.id + 1000 },
            connection: { ...odsConnA2425, id: odsConnA2425.id + 1000 },
          });

          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          try {
            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Multiple ODS found');
          } finally {
            await prisma.odsConfig.delete({
              where: { id: secondOds.id }, // connection will delete with cascade
            });
          }
        });

        it('should ignore retired ODSs', async () => {
          await prisma.odsConfig.update({
            where: { id: odsConfigA2425.id },
            data: { retired: true, retiredOn: new Date() },
          });
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          try {
            expect(res.status).toBe(400);
            expect(res.body.message).toContain('No ODS found');
          } finally {
            await prisma.odsConfig.update({
              where: { id: odsConfigA2425.id },
              data: { retired: false, retiredOn: null },
            });
          }
        });

        it('should ensure all required inputs are provided', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              params: { ...jobInput.params, FORMAT: undefined },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Missing required params');
        });

        it('should ensure all inputs are valid', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              params: { ...jobInput.params, FORMAT: 'not a format' },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Invalid param input');
          expect(res.body.message).toContain('FORMAT');
        });

        it('should reject requests if unexpected files are provided', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              files: { ...jobInput.files, UNEXPECTED_FILE: 'unexpected-file.csv' },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Unexpected file input');
          expect(res.body.message).toContain('UNEXPECTED_FILE');
        });

        it('should reject requests if required files are missing', async () => {
          const token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              files: { ...jobInput.files, INPUT_FILE: undefined },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Missing required files');
          expect(res.body.message).toContain('INPUT_FILE');
        });
      });
    });

    describe('POST /jobs/:jobUid/start', () => {
      let earthbeamMock: jest.SpyInstance;
      let bundleMock: jest.SpyInstance;
      let jobUid: string;
      let token: string;

      beforeEach(async () => {
        earthbeamMock = jest.spyOn(EarthbeamRunService.prototype, 'start').mockResolvedValue({
          result: 'JOB_STARTED',
          job: { id: 123 } as Job, // doesn't really matter
        });
        bundleMock = jest
          .spyOn(EarthbeamBundlesService.prototype, 'getBundles')
          .mockResolvedValue(allBundles);

        token = await signExternalApiToken({ scope: 'create:jobs partner:partner-a' });
        const res = await request(app.getHttpServer())
          .post('/v1/jobs')
          .set('Authorization', `Bearer ${token}`)
          .send({
            partner: partnerA.id,
            tenant: tenantA.code,
            bundle: bundleA.path,
            schoolYear: '2425',
            files: { INPUT_FILE: 'input-file.csv' },
            params: { FORMAT: 'Standard' },
          });
        jobUid = res.body.uid;
      });

      afterEach(async () => {
        await prisma.job.delete({
          where: { uid: jobUid },
        });
        bundleMock.mockRestore();
        earthbeamMock.mockRestore();
      });

      describe('Valid Request', () => {
        it('should return a 200 if the job is started', async () => {
          const res = await request(app.getHttpServer())
            .post(`/v1/jobs/${jobUid}/start`)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(201);
        });
      });
      describe('Invalid Request', () => {
        it('should return a 400 if not given a uuid', async () => {
          const res = await request(app.getHttpServer())
            .post(`/v1/jobs/not-a-uuid/start`)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('uuid is expected');
        });

        it('should return a 404 if the job is not found', async () => {
          // Create a valid UUID that's guaranteed to be different by cycling the first hex char
          const firstChar = jobUid[0];
          const newFirstChar = firstChar === 'f' ? '0' : (parseInt(firstChar, 16) + 1).toString(16);
          const differentUid = newFirstChar + jobUid.slice(1);

          const res = await request(app.getHttpServer())
            .post(`/v1/jobs/${differentUid}/start`)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(404);
          expect(res.body.message).toContain('Job not found');
        });

        it('should return a 404 if the job is not owned by a partner in the token scope', async () => {
          const tokenB = await signExternalApiToken({ scope: 'create:jobs partner:partner-b' });
          const res = await request(app.getHttpServer())
            .post(`/v1/jobs/${jobUid}/start`)
            .set('Authorization', `Bearer ${tokenB}`);
          expect(res.status).toBe(404);
          expect(res.body.message).toContain('Job not found');
        });

        it('should return a 400 if the files are not found', async () => {
          const fileServiceMock = app.get(FileService).doFilesExist as jest.Mock;
          fileServiceMock.mockResolvedValue(false);
          const res = await request(app.getHttpServer())
            .post(`/v1/jobs/${jobUid}/start`)
            .set('Authorization', `Bearer ${token}`);

          try {
            expect(res.status).toBe(400);
            expect(res.body.message).toContain('files were not found');
          } finally {
            fileServiceMock.mockResolvedValue(true);
          }
        });
      });
    });
  });
});
