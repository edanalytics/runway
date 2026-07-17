import request from 'supertest';
import { signExternalApiToken, TEST_ISSUER } from '../helpers/external-api/token-helper';
import * as jose from 'jose';
import { EXTERNAL_API_SCOPE_KEY } from '../../src/external-api/auth/external-api-scope.decorator';
import { ExternalApiV1TokenController } from '../../src/external-api/v1/token.v1.controller';
import { partnerA, partnerX } from '../fixtures/context-fixtures/partner-fixtures';
import { tenantA, tenantB, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { allBundles, bundleA, bundleB, bundleX } from '../fixtures/em-bundle-fixtures';
import { EarthbeamBundlesService } from 'api/src/earthbeam/earthbeam-bundles.service';
import { odsConfigA2425, odsConfigA2526, odsConfigB2526, odsConfigX2425 } from '../fixtures/context-fixtures/ods-fixture';
import { schoolYear2425, schoolYear2526 } from '../fixtures/context-fixtures/school-year-fixtures';

import { FileService } from 'api/src/files/file.service';
import { ExternalApiAuthService } from '../../src/external-api/auth/external-api.auth.service';
import { authHelper } from '../helpers/oidc/auth-flow';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { userA } from '../fixtures/user-fixtures';
import { GetJobDto } from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { ExecutorAwsService } from 'api/src/earthbeam/executor/executor.aws.service';
import { seedJob } from '../factories/job-factory';

describe('ExternalApiV1', () => {
  describe('Token Auth', () => {
    const endpoint = '/v1/token/verify';
    const tokenPayload = {
      scope: 'create:jobs partner:partner-a',
      client_id: 'test-client-id',
      client_name: 'Test API Client',
    };

    describe('Valid Token', () => {
      it('should return 201 if the token is valid', async () => {
        const token = await signExternalApiToken(tokenPayload);
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
        const token = await signExternalApiToken(tokenPayload);
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
        const token = await signExternalApiToken(tokenPayload);
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
          tokenPayload,
          { privateKey: newKeyPair.privateKey } // signing the token with this new private key means it can't be verified with the public key jose is using
        );
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });

      it('should return 401 if the audience is invalid', async () => {
        const token = await signExternalApiToken(tokenPayload, { audience: 'invalid' });
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });

      it('should return 401 if the token is expired', async () => {
        const token = await signExternalApiToken(tokenPayload, { expiresIn: '-1s' }); // you can sign expired tokens!
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });

      it('should return 403 if required scope is missing', async () => {
        const token = await signExternalApiToken({
          ...tokenPayload,
          scope: tokenPayload.scope.replace('create:jobs', '').trim(),
        }); // no create:jobs scope
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });

      it('should return 403 if ANY required scope is missing', async () => {
        const token = await signExternalApiToken(tokenPayload); // has create:jobs but not read:jobs
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
        const token = await signExternalApiToken({ ...tokenPayload, scope: undefined });
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });
    });

    describe('Token auth not configured', () => {
      it('should return 503 if token auth is not configured', async () => {
        // it'd be nice to mock audience or the keyset being absent, but that gets too involved, so for now
        // test that if the auth service reports that token auth is disabled, for whatever reason, we return a 503
        const externalApiAuthService = app.get(ExternalApiAuthService);
        const verifyTokenMock = jest
          .spyOn(externalApiAuthService, 'verifyToken')
          .mockResolvedValue({ result: 'disabled' });

        const token = await signExternalApiToken(tokenPayload);
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);

        try {
          expect(res.status).toBe(503);
        } finally {
          verifyTokenMock.mockRestore();
        }
      });
    });
  });

  describe('Jobs V1', () => {
    const tokenPayload = {
      scope: 'create:jobs partner:partner-a',
      client_id: 'test-client-id',
      client_name: 'Test API Client',
    };
    let token: string;

    beforeAll(async () => {
      token = await signExternalApiToken(tokenPayload);
    });

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
          schoolYear: '2025',
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
          const token = await signExternalApiToken(tokenPayload);
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          expect(res.status).toBe(201);
          expect(res.body.uid).toBeDefined();
          expect(res.body.uploadUrls).toHaveProperty('INPUT_FILE');
          expect(res.body.uploadUrls.INPUT_FILE).toContain(jobInput.files.INPUT_FILE); // FileService.getPresignedUploadUrl is mocked in init-app.ts
          expect(res.body.uploadUrls.INPUT_FILE).toContain('s3-test-upload-url://');

          const job = await prisma.job.findUnique({ where: { uid: res.body.uid } });
          expect(job?.odsId).toBe(odsConfigA2425.id);
          expect(job?.sendToOds).toBe(true);
        });

        it('should trim whitespace from file names', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              files: { INPUT_FILE: '  input-file.csv  ' },
            });

          expect(res.status).toBe(201);

          const job = await prisma.job.findUnique({
            where: { uid: res.body.uid },
            include: { files: true },
          });

          expect(job).not.toBeNull();
          const inputFile = job!.files.find((f) => f.templateKey === 'INPUT_FILE');
          expect(inputFile).toBeDefined();
          expect(inputFile!.nameFromUser).toBe('input-file.csv');
        });

        it('should create a no-ODS job when the year is configured not to send to ODS', async () => {
          await prisma.schoolYearConfig.create({
            data: {
              partnerId: partnerA.id,
              schoolYearId: '2324',
              isEnabled: true,
              sendToOds: false,
            },
          });

          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              schoolYear: '2024',
            });

          expect(res.status).toBe(201);

          const job = await prisma.job.findUnique({ where: { uid: res.body.uid } });
          expect(job?.odsId).toBeNull();
          expect(job?.sendToOds).toBe(false);
        });

        it('should create a no-ODS job without a roster file when cross-year matching is enabled', async () => {
          await prisma.schoolYearConfig.create({
            data: {
              partnerId: partnerA.id,
              schoolYearId: '2324',
              isEnabled: true,
              sendToOds: false,
            },
          });
          await prisma.partner.update({
            where: { id: partnerA.id },
            data: { crossYearMatchingEnabled: true },
          });

          const doesFileExistMock = app.get(FileService).doesFileExist as jest.Mock;
          doesFileExistMock.mockResolvedValue(false);

          try {
            const res = await request(app.getHttpServer())
              .post(endpoint)
              .set('Authorization', `Bearer ${token}`)
              .send({
                ...jobInput,
                schoolYear: '2024',
              });

            expect(res.status).toBe(201);

            const job = await prisma.job.findUnique({ where: { uid: res.body.uid } });
            expect(job?.odsId).toBeNull();
            expect(job?.sendToOds).toBe(false);
          } finally {
            // No partner reset needed — seed data is refreshed before each test
            doesFileExistMock.mockResolvedValue(true);
          }
        });
      });

      describe('API Client Info', () => {
        it('should store API client info from token claims', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          expect(res.status).toBe(201);

          // Verify the values were stored in the database
          const job = await prisma.job.findUnique({
            where: { uid: res.body.uid },
          });

          expect(job).not.toBeNull();
          expect(job!.apiIssuer).toBe(TEST_ISSUER);
          expect(job!.apiClientId).toBe(tokenPayload.client_id);
          expect(job!.apiClientName).toBe(tokenPayload.client_name);
        });

        it('should use azp claim when client_id is absent', async () => {
          const token = await signExternalApiToken({
            ...tokenPayload,
            azp: 'test-azp',
            client_id: undefined,
          });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          expect(res.status).toBe(201);

          const job = await prisma.job.findUnique({
            where: { uid: res.body.uid },
          });

          expect(job).not.toBeNull();
          expect(job!.apiClientId).toBe('test-azp');
          expect(job!.apiClientName).toBe(tokenPayload.client_name);
        });

        it('should prefer client_id over azp when both are present', async () => {
          const token = await signExternalApiToken({
            ...tokenPayload,
            azp: 'test-azp',
          });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          expect(res.status).toBe(201);

          const job = await prisma.job.findUnique({
            where: { uid: res.body.uid },
          });

          expect(job).not.toBeNull();
          expect(job!.apiClientId).toBe(tokenPayload.client_id);
        });

        it('should return 403 if the token is missing azp or client_id claim', async () => {
          const token = await signExternalApiToken({
            ...tokenPayload,
            azp: undefined,
            client_id: undefined,
          });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);
          expect(res.status).toBe(403);
        });

        it('should handle missing client_name gracefully', async () => {
          const token = await signExternalApiToken({
            ...tokenPayload,
            client_name: undefined,
          });
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          expect(res.status).toBe(201);

          const job = await prisma.job.findUnique({
            where: { uid: res.body.uid },
          });

          expect(job).not.toBeNull();
          expect(job!.apiIssuer).toBe(TEST_ISSUER);
          expect(job!.apiClientId).toBe(tokenPayload.client_id);
          expect(job!.apiClientName).toBeNull();
        });

        it('should expose apiClientName and isApiInitiated in DTO, but not apiIssuer or apiClientId', async () => {
          const createRes = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);

          expect(createRes.status).toBe(201);

          // Get the job ID from the database (we need the numeric ID for the GET endpoint)
          const job = await prisma.job.findUnique({
            where: { uid: createRes.body.uid },
          });
          expect(job).not.toBeNull();

          // Log in as userA in tenantA to access the regular API
          const { cookies } = await authHelper.login(idpA, userA, tenantA);

          // Hit the GET /jobs/:id endpoint
          const getRes = await request(app.getHttpServer())
            .get(`/jobs/${job!.id}`)
            .set('Cookie', cookies);

          expect(getRes.status).toBe(200);

          const jobDto = plainToInstance(GetJobDto, getRes.body);

          // apiClientName and isApiInitiated should be exposed in the response
          expect(jobDto.apiClientName).toBe(tokenPayload.client_name);
          expect(jobDto.isApiInitiated).toBe(true);

          // apiIssuer and apiClientId should NOT be in the response
          expect(jobDto.apiIssuer).toBeUndefined();
          expect(jobDto.apiClientId).toBeUndefined();
        });
      });

      describe('Invalid Request', () => {
        it('should reject requests without a partner scope', async () => {
          const token = await signExternalApiToken({ ...tokenPayload, scope: 'create:jobs' });
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
          const token = await signExternalApiToken({
            ...tokenPayload,
            scope: 'create:jobs partner:partner-b',
          }); // request is for partner-a
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);
          expect(res.status).toBe(403);
          expect(res.body.message).toContain('Invalid partner code');
        });

        it('should reject requests for tenants outside the scoped partner', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({ ...jobInput, tenant: tenantX.code }); // partner/tenant mismatch
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Invalid tenant');
        });

        it('should reject requests for non-existent bundles', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              bundle: 'does-not-exist',
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Bundle not found or not enabled for partner');
        });

        it('should reject requests if the bundle is not enabled for the partner', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              bundle: bundleX.path,
            });

          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Bundle not found or not enabled for partner');
        });

        it('should return a 500 if the bundle metadata cannot be retrieved', async () => {
          // bundle enablement check should pass, but bundle retrieval should fail
          getBundleMock.mockResolvedValue([]);
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send(jobInput);
          expect(res.status).toBe(500);
        });

        it('should reject requests if an enabled send-to-ODS year has no ODS', async () => {
          await prisma.schoolYearConfig.create({
            data: {
              partnerId: partnerA.id,
              schoolYearId: '2324',
              isEnabled: true,
              sendToOds: true,
            },
          });

          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              schoolYear: '2024',
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('No ODS found');
        });

        it('should reject requests when no school year config row exists', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              schoolYear: '2024', // 2324 school year has no config row
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('School year is not enabled');
        });

        it('should reject no-ODS years when the roster file is missing', async () => {
          await prisma.schoolYearConfig.create({
            data: {
              partnerId: partnerA.id,
              schoolYearId: '2324',
              isEnabled: true,
              sendToOds: false,
            },
          });

          const doesFileExistMock = app.get(FileService).doesFileExist as jest.Mock;
          doesFileExistMock.mockResolvedValue(false);

          try {
            const res = await request(app.getHttpServer())
              .post(endpoint)
              .set('Authorization', `Bearer ${token}`)
              .send({
                ...jobInput,
                schoolYear: '2024',
              });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain(
              'No roster file found and cross-year matching not enabled'
            );
          } finally {
            doesFileExistMock.mockResolvedValue(true);
          }
        });

        it('should reject requests with an invalid school year format', async () => {
          // This test checks that we're hitting the class validator requirements in the DTO
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({ ...jobInput, schoolYear: '2025-2026' });
          expect(res.status).toBe(400);
          expect(res.body.message).toEqual(
            expect.arrayContaining([
              expect.stringContaining('School year must be a 4-digit end year'),
            ])
          );
        });

        it('should ignore retired ODSs', async () => {
          await prisma.odsConfig.update({
            where: { id: odsConfigA2425.id },
            data: { retired: true, retiredOn: new Date() },
          });
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
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              params: { ...jobInput.params, FORMAT: 'not a format' },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Invalid param values');
          expect(res.body.message).toContain('FORMAT');
        });

        it('should reject null param values for required params', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              params: { ...jobInput.params, FORMAT: null },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('FORMAT');
        });

        it('should reject requests if unexpected params are provided', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              params: { ...jobInput.params, UNEXPECTED_PARAM: 'some-value' },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Unexpected params');
          expect(res.body.message).toContain('UNEXPECTED_PARAM');
        });

        it('should reject requests if unexpected files are provided', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              files: { ...jobInput.files, UNEXPECTED_FILE: 'unexpected-file.csv' },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Unexpected files');
          expect(res.body.message).toContain('UNEXPECTED_FILE');
        });

        it('should reject requests if required files are missing', async () => {
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

        it('should reject requests if a file name is an empty string', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              files: { INPUT_FILE: '' },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('File names must not be empty');
        });

        it('should reject requests if a file name is null', async () => {
          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`)
            .send({
              ...jobInput,
              files: { INPUT_FILE: null },
            });
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('File names must not be empty');
        });
      });
    });

    describe('POST /jobs/:jobUid/start', () => {
      let earthbeamMock: jest.SpyInstance;
      let bundleMock: jest.SpyInstance;
      let jobUid: string;

      beforeEach(async () => {
        earthbeamMock = jest
          .spyOn(ExecutorAwsService.prototype, 'start')
          .mockResolvedValue(undefined);
        bundleMock = jest
          .spyOn(EarthbeamBundlesService.prototype, 'getBundles')
          .mockResolvedValue(allBundles);

        const res = await request(app.getHttpServer())
          .post('/v1/jobs')
          .set('Authorization', `Bearer ${token}`)
          .send({
            partner: partnerA.id,
            tenant: tenantA.code,
            bundle: bundleA.path,
            schoolYear: '2025',
            files: { INPUT_FILE: 'input-file.csv' },
            params: { FORMAT: 'Standard' },
          });
        jobUid = res.body.uid;
      });

      afterEach(async () => {
        bundleMock.mockRestore();
        earthbeamMock.mockRestore();
      });

      describe('Valid Request', () => {
        it('should return a 202 if the job is started', async () => {
          const res = await request(app.getHttpServer())
            .post(`/v1/jobs/${jobUid}/start`)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(202);
        });
      });

      describe('Invalid Request', () => {
        it('should return a 401 if not given a valid token', async () => {
          const res = await request(app.getHttpServer())
            .post(`/v1/jobs/${jobUid}/start`)
            .set('Authorization', `Bearer invalid`);
          expect(res.status).toBe(401);
        });

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
          const tokenB = await signExternalApiToken({
            ...tokenPayload,
            scope: 'create:jobs partner:partner-b',
          });
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

  describe('Output Sets V1', () => {
    const seedOutputSet = async (overrides: {
      odsConfig?: typeof odsConfigA2425;
      bundle?: typeof bundleA;
      tenant?: typeof tenantA;
      runStatus?: 'success' | 'error' | 'new' | 'running';
      files?: string[];
      sentToOds?: boolean;
    } = {}) => {
      const job = await seedJob({
        odsConfig: overrides.odsConfig ?? odsConfigA2425,
        bundle: overrides.bundle ?? bundleA,
        tenant: overrides.tenant ?? tenantA,
        runStatus: overrides.runStatus ?? 'success',
      });
      const set = await prisma.runOutputFileSet.create({
        data: {
          runId: job.runs[0].id,
          files: overrides.files ?? ['output.jsonl'],
          sentToOds: overrides.sentToOds ?? true,
          path: `${job.fileBasePath}/output`,
        },
      });
      return { job, set };
    };

    describe('GET /output-sets', () => {
      const endpoint = '/v1/output-sets';

      describe('with invalid token', () => {
        it('should return 401 without a token', async () => {
          const res = await request(app.getHttpServer())
            .get(endpoint)
            .query({ partner: partnerA.id });
          expect(res.status).toBe(401);
        });

        it('should return 403 with token missing read:jobs scope', async () => {
          const token = await signExternalApiToken({
            scope: 'create:jobs partner:partner-a',
          });
          const res = await request(app.getHttpServer())
            .get(endpoint)
            .query({ partner: partnerA.id })
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(403);
        });
      });

      describe('with valid token', () => {
        let token: string;

        beforeAll(async () => {
          token = await signExternalApiToken({
            scope: 'read:jobs partner:partner-a',
          });
        });

        it('should return 400 without required partner parameter', async () => {
          const res = await request(app.getHttpServer())
            .get(endpoint)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(400);
        });

        it('should return 400 for invalid sentToOds value', async () => {
          const res = await request(app.getHttpServer())
            .get(endpoint)
            .query({ partner: partnerA.id, sentToOds: 'yes' })
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('sentToOds');
        });

        it.each([
          'not-a-date',
          '03/15/2024',
          'March 15, 2024',
          '2024-03-15 00:00:00Z',
        ])('should return 400 for non-ISO createdAfter value: %s', async (value) => {
          const res = await request(app.getHttpServer())
            .get(endpoint)
            .query({ partner: partnerA.id, createdAfter: value })
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('ISO 8601 timestamp');
        });

        it('should return 400 for invalid schoolYear value', async () => {
          const res = await request(app.getHttpServer())
            .get(endpoint)
            .query({ partner: partnerA.id, schoolYear: '2024abc' })
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('schoolYear');
        });

        it('should return 400 for unknown schoolYear', async () => {
          const res = await request(app.getHttpServer())
            .get(endpoint)
            .query({ partner: partnerA.id, schoolYear: '1999' })
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(400);
          expect(res.body.message).toContain('Unknown school year');
        });

        it('should return 404 when partner does not match token scopes', async () => {
          const tokenWrongPartner = await signExternalApiToken({
            scope: 'read:jobs partner:partner-b',
          });
          const res = await request(app.getHttpServer())
            .get(endpoint)
            .query({ partner: partnerA.id })
            .set('Authorization', `Bearer ${tokenWrongPartner}`);
          expect(res.status).toBe(404);
        });

        describe('filters', () => {
          const listOutputSets = (query: Record<string, string> = {}) =>
            request(app.getHttpServer())
              .get(endpoint)
              .query({ partner: partnerA.id, ...query })
              .set('Authorization', `Bearer ${token}`);

          let setA: Awaited<ReturnType<typeof seedOutputSet>>;

          beforeEach(async () => {
            setA = await seedOutputSet({
              files: ['output1.jsonl', 'output2.jsonl'],
            });
          });

          it('should return output sets with correct shape', async () => {
            const res = await listOutputSets();

            expect(res.status).toBe(200);
            expect(res.body).toBeInstanceOf(Array);
            expect(res.body).toHaveLength(1);

            const set = res.body[0];
            expect(set.uid).toBe(setA.set.uid);
            expect(set.files).toEqual(['output1.jsonl', 'output2.jsonl']);
            expect(set.sentToOds).toBe(true);
            expect(set.createdAt).toBeDefined();
            expect(set.jobUid).toBe(setA.job.uid);
            expect(set.partner).toBe(partnerA.id);
            expect(set.tenant).toBe(tenantA.code);
            expect(set.schoolYear).toBe(String(schoolYear2425.endYear));
            expect(set.bundle).toBe(bundleA.path);
          });

          it('should only include sets from successful runs', async () => {
            await seedOutputSet({ runStatus: 'error' });

            const res = await listOutputSets();

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].uid).toBe(setA.set.uid);
          });

          it('should exclude sets from other partners', async () => {
            await seedOutputSet({
              odsConfig: odsConfigX2425,
              bundle: bundleX,
              tenant: tenantX,
            });

            const res = await listOutputSets();

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].uid).toBe(setA.set.uid);
          });

          it('should filter by tenant', async () => {
            await seedOutputSet({
              odsConfig: odsConfigB2526,
              tenant: tenantB,
            });

            const resAll = await listOutputSets();
            expect(resAll.body).toHaveLength(2);

            const res = await listOutputSets({ tenant: tenantA.code });
            expect(res.body).toHaveLength(1);
            expect(res.body[0].tenant).toBe(tenantA.code);
          });

          it('should filter by schoolYear (end year)', async () => {
            await seedOutputSet({
              odsConfig: odsConfigA2526,
            });

            const resAll = await listOutputSets();
            expect(resAll.body).toHaveLength(2);

            const res = await listOutputSets({ schoolYear: String(schoolYear2425.endYear) });
            expect(res.body).toHaveLength(1);
            expect(res.body[0].schoolYear).toBe(String(schoolYear2425.endYear));
          });

          it('should filter by sentToOds', async () => {
            await seedOutputSet({ sentToOds: false });

            const resAll = await listOutputSets();
            expect(resAll.body).toHaveLength(2);

            const res = await listOutputSets({ sentToOds: 'false' });
            expect(res.body).toHaveLength(1);
            expect(res.body[0].sentToOds).toBe(false);
          });

          it('should filter by createdAfter', async () => {
            // Backdate setA to a known old timestamp
            await prisma.runOutputFileSet.update({
              where: { uid: setA.set.uid },
              data: { createdOn: new Date('2020-01-01T00:00:00Z') },
            });

            const { set: newerSet } = await seedOutputSet();

            const resAll = await listOutputSets();
            expect(resAll.body).toHaveLength(2);

            const res = await listOutputSets({ createdAfter: '2024-01-01T00:00:00Z' });
            expect(res.body).toHaveLength(1);
            expect(res.body[0].uid).toBe(newerSet.uid);
          });

          it('should filter by bundle', async () => {
            await seedOutputSet({
              odsConfig: odsConfigA2526,
              bundle: bundleB,
            });

            const resAll = await listOutputSets();
            expect(resAll.body).toHaveLength(2);

            const res = await listOutputSets({ bundle: bundleA.path });
            expect(res.body).toHaveLength(1);
            expect(res.body[0].bundle).toBe(bundleA.path);
          });

          it('should return results ordered by createdAt ascending', async () => {
            // Give setA an explicit later timestamp
            await prisma.runOutputFileSet.update({
              where: { uid: setA.set.uid },
              data: { createdOn: new Date('2025-06-01T00:00:00Z') },
            });

            const { set: olderSet } = await seedOutputSet();
            await prisma.runOutputFileSet.update({
              where: { uid: olderSet.uid },
              data: { createdOn: new Date('2025-01-01T00:00:00Z') },
            });

            const res = await listOutputSets();

            expect(res.body).toHaveLength(2);
            expect(res.body[0].uid).toBe(olderSet.uid);
            expect(res.body[1].uid).toBe(setA.set.uid);
          });
        });
      });
    });

    describe('POST /output-sets/:setUid/download-links', () => {
      it('should return 401 without a token', async () => {
        const res = await request(app.getHttpServer())
          .post('/v1/output-sets/00000000-0000-0000-0000-000000000000/download-links');
        expect(res.status).toBe(401);
      });

      it('should return 403 with token missing read:jobs:output-files scope', async () => {
        const token = await signExternalApiToken({
          scope: 'read:jobs partner:partner-a',
        });
        const res = await request(app.getHttpServer())
          .post('/v1/output-sets/00000000-0000-0000-0000-000000000000/download-links')
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });

      describe('with valid token', () => {
        let token: string;

        beforeAll(async () => {
          token = await signExternalApiToken({
            scope: 'read:jobs:output-files partner:partner-a',
          });
        });

        it('should return 404 when set UID does not exist', async () => {
          const res = await request(app.getHttpServer())
            .post('/v1/output-sets/00000000-0000-0000-0000-000000000000/download-links')
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(404);
        });

        it('should return 404 when set belongs to a different partner', async () => {
          const { set: setX } = await seedOutputSet({
            odsConfig: odsConfigX2425,
            bundle: bundleX,
            tenant: tenantX,
          });

          const res = await request(app.getHttpServer())
            .post(`/v1/output-sets/${setX.uid}/download-links`)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(404);
        });

        it('should return presigned download links for all files in the set', async () => {
          const { set: setA } = await seedOutputSet({
            files: ['output1.jsonl', 'output2.jsonl'],
          });

          const res = await request(app.getHttpServer())
            .post(`/v1/output-sets/${setA.uid}/download-links`)
            .set('Authorization', `Bearer ${token}`);

          expect(res.status).toBe(200);
          expect(res.body.downloadLinks).toBeDefined();
          expect(Object.keys(res.body.downloadLinks)).toEqual(['output1.jsonl', 'output2.jsonl']);

          // FileService.getPresignedDownloadUrl is mocked to return `s3-test-download-url://{fullPath}`
          expect(res.body.downloadLinks['output1.jsonl']).toContain('s3-test-download-url://');
          expect(res.body.downloadLinks['output1.jsonl']).toContain(`${setA.path}/output1.jsonl`);
          expect(res.body.downloadLinks['output2.jsonl']).toContain(`${setA.path}/output2.jsonl`);
        });
      });
    });
  });
});
