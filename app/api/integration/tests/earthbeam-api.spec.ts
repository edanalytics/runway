import { Logger } from '@nestjs/common';
import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import { EduSnowflakePoolService } from 'api/src/earthbeam/api/edu-snowflake-pool.service';
import { AppConfigService } from 'api/src/config/app-config.service';
import { Readable } from 'node:stream';
import request from 'supertest';
import { seedJob } from '../factories/job-factory';
import { bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigX2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { Run } from '@prisma/client';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { EventEmitterLogService, EVENT_EMITTER_SERVICE } from 'api/src/event-emitter/event-emitter.service';
import { userA } from '../fixtures/user-fixtures';
import { FileService } from 'api/src/files/file.service';
import { IdrsCredentialsService } from 'api/src/earthbeam/api/idrs-credentials.service';

describe('Earthbeam API', () => {
  describe('GET /:runId', () => {
    let runA: Run;
    let endpointA: string;
    let tokenA: string;

    let runX: Run;
    let endpointX: string;
    let tokenX: string;

    beforeEach(async () => {
      const authService = app.get(EarthbeamApiAuthService);

      // Job A
      const jobA = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });


      runA = jobA.runs[0];
      endpointA = `/earthbeam/jobs/${runA.id}`;
      tokenA = await authService.createAccessToken({ runId: runA.id });

      // Job X
      const jobX = await seedJob({
        odsConfig: odsConfigX2425,
        bundle: bundleX,
        tenant: tenantX,
      });

      runX = jobX.runs[0];
      endpointX = `/earthbeam/jobs/${runX.id}`;
      tokenX = await authService.createAccessToken({ runId: runX.id });
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app.getHttpServer()).get(endpointA);
      expect(res.status).toBe(401);
    });

    it('should reject requests if the token does not match the run id', async () => {
      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenX}`);
      expect(res.status).toBe(403);
    });

    it('should include appUrls.outputFiles in the job payload', async () => {
      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.appUrls.outputFiles).toBeDefined();
      expect(res.body.appUrls.outputFiles).toContain(`/earthbeam/jobs/${runA.id}/output-files`);
    });

    it('should include ODS credentials for send-to-ODS jobs', async () => {
      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.sendToOds).toBe(true);
      expect(res.body.assessmentDatastore).toBeDefined();
      expect(res.body.rosterFilePath).toBeUndefined();
    });

    it('should omit ODS credentials and include a roster path for no-ODS jobs', async () => {
      const authService = app.get(EarthbeamApiAuthService);
      const noOdsJob = await seedJob({
        sendToOds: false,
        schoolYearId: '2324',
        bundle: bundleA,
        tenant: tenantA,
      });

      const noOdsRun = noOdsJob.runs[0];
      const noOdsToken = await authService.createAccessToken({ runId: noOdsRun.id });
      const res = await request(app.getHttpServer())
        .get(`/earthbeam/jobs/${noOdsRun.id}`)
        .set('Authorization', `Bearer ${noOdsToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sendToOds).toBe(false);
      expect(res.body.assessmentDatastore).toBeUndefined();
      expect(res.body.rosterFilePath).toBe(
        's3://test-file-bucket/__rosters/partner-a/tenant-a/2024/studentEducationOrganizationAssociations.jsonl'
      );
    });

    describe('cross-year ID matching', () => {
      // crossYearMatchAvailable mirrors the partner toggle alone — there is no
      // creds/connection check at run-prep time. EDU problems surface as loud
      // run failures at roster-fetch time instead of silent degradation.
      beforeEach(async () => {
        await global.prisma.partner.update({
          where: { id: partnerA.id },
          data: { crossYearMatchingEnabled: true },
        });
      });

      it('sets crossYearMatchAvailable=true and emits appUrls.roster when the partner toggle is on', async () => {
        const res = await request(app.getHttpServer())
          .get(endpointA)
          .set('Authorization', `Bearer ${tokenA}`);

        expect(res.status).toBe(200);
        expect(res.body.crossYearMatchAvailable).toBe(true);
        expect(res.body.appUrls.roster).toBeDefined();
        expect(res.body.appUrls.roster).toContain(`/earthbeam/jobs/${runA.id}/roster`);
      });

      it('sets crossYearMatchAvailable=false and omits appUrls.roster when toggle is off', async () => {
        await global.prisma.partner.update({
          where: { id: partnerA.id },
          data: { crossYearMatchingEnabled: false },
        });

        const res = await request(app.getHttpServer())
          .get(endpointA)
          .set('Authorization', `Bearer ${tokenA}`);

        expect(res.status).toBe(200);
        expect(res.body.crossYearMatchAvailable).toBe(false);
        expect(res.body.appUrls.roster).toBeUndefined();
      });

      it('omits rosterFilePath on a no-ODS job when cross-year matching is available (EDU is the source)', async () => {
        const authService = app.get(EarthbeamApiAuthService);
        const noOdsJob = await seedJob({
          sendToOds: false,
          schoolYearId: '2324',
          bundle: bundleA,
          tenant: tenantA,
        });
        const noOdsRun = noOdsJob.runs[0];
        const noOdsToken = await authService.createAccessToken({ runId: noOdsRun.id });

        const res = await request(app.getHttpServer())
          .get(`/earthbeam/jobs/${noOdsRun.id}`)
          .set('Authorization', `Bearer ${noOdsToken}`);

        expect(res.status).toBe(200);
        expect(res.body.crossYearMatchAvailable).toBe(true);
        expect(res.body.appUrls.roster).toBeDefined();
        expect(res.body.rosterFilePath).toBeUndefined();
      });
    });

    describe('id matching mode', () => {
      const payloadFor = async (idMatchingMode: 'fuzzy' | 'id_based_fuzzy_background') => {
        const authService = app.get(EarthbeamApiAuthService);
        const job = await seedJob({
          odsConfig: odsConfigA2425,
          bundle: bundleA,
          tenant: tenantA,
          idMatchingMode,
        });
        const run = job.runs[0];
        const token = await authService.createAccessToken({ runId: run.id });
        const res = await request(app.getHttpServer())
          .get(`/earthbeam/jobs/${run.id}`)
          .set('Authorization', `Bearer ${token}`);
        return { res, run };
      };

      it('reports id_based and omits the identity-service callback by default', async () => {
        const res = await request(app.getHttpServer())
          .get(endpointA)
          .set('Authorization', `Bearer ${tokenA}`);

        expect(res.status).toBe(200);
        expect(res.body.idMatchingMode).toBe('id_based');
        expect(res.body.appUrls.identityService).toBeUndefined();
        expect(res.body.appUrls.unmatchedStudentRecords).toBeUndefined();
      });

      it.each(['fuzzy', 'id_based_fuzzy_background'] as const)(
        'advertises the identity-service callback for %s',
        async (idMatchingMode) => {
          const { res, run } = await payloadFor(idMatchingMode);

          expect(res.status).toBe(200);
          expect(res.body.idMatchingMode).toBe(idMatchingMode);
          expect(res.body.appUrls.identityService).toContain(
            `/earthbeam/jobs/${run.id}/identity-service`
          );
          expect(res.body.appUrls.unmatchedStudentRecords).toContain(
            `/earthbeam/jobs/${run.id}/unmatched-student-records`
          );
        }
      );

      it('keeps the cross-year roster callback in background mode', async () => {
        await global.prisma.partner.update({
          where: { id: partnerA.id },
          data: { crossYearMatchingEnabled: true },
        });

        const { res } = await payloadFor('id_based_fuzzy_background');

        // Background mode still runs the authoritative ID-based pass.
        expect(res.body.crossYearMatchAvailable).toBe(true);
        expect(res.body.appUrls.roster).toBeDefined();
      });

      it('omits both roster sources in pure fuzzy', async () => {
        await global.prisma.partner.update({
          where: { id: partnerA.id },
          data: { crossYearMatchingEnabled: true },
        });

        const { res } = await payloadFor('fuzzy');

        // crossYearMatchAvailable still mirrors the live partner setting —
        // IDRS may return cross-year results — but nothing roster-matches.
        expect(res.body.crossYearMatchAvailable).toBe(true);
        expect(res.body.appUrls.roster).toBeUndefined();
        expect(res.body.rosterFilePath).toBeUndefined();
      });

      it('omits the S3 roster path for a no-ODS fuzzy job', async () => {
        const authService = app.get(EarthbeamApiAuthService);
        const noOdsJob = await seedJob({
          sendToOds: false,
          schoolYearId: '2324',
          bundle: bundleA,
          tenant: tenantA,
          idMatchingMode: 'fuzzy',
        });
        const noOdsRun = noOdsJob.runs[0];
        const noOdsToken = await authService.createAccessToken({ runId: noOdsRun.id });

        const res = await request(app.getHttpServer())
          .get(`/earthbeam/jobs/${noOdsRun.id}`)
          .set('Authorization', `Bearer ${noOdsToken}`);

        expect(res.status).toBe(200);
        expect(res.body.rosterFilePath).toBeUndefined();
        expect(res.body.appUrls.roster).toBeUndefined();
      });
    });

    // TODO: add tests for things other than descriptor mappings
    describe('Authenticated requests: Descriptor Mappings', () => {
      const testDescriptorTypeA = 'testDescriptorTypeA';
      const testDescriptorTypeB = 'testDescriptorTypeB';

      beforeEach(async () => {
        const bundleDescriptorMappings = [
          {
            bundleKey: bundleA.path,
            descriptorType: testDescriptorTypeA,
            leftHandSideColumns: { abc: '1', def: '2', ghi: '3' } as Record<string, string>,
            edfiDefaultDescriptor: 'uri://ed-fi.org/testDescriptorA1',
          },
          {
            bundleKey: bundleA.path,
            descriptorType: testDescriptorTypeA,
            leftHandSideColumns: { abc: '4', def: '5', ghi: '6' },
            edfiDefaultDescriptor: 'uri://ed-fi.org/testDescriptorA2',
          },
          {
            bundleKey: bundleA.path,
            descriptorType: testDescriptorTypeB,
            leftHandSideColumns: { jkl: '7', mno: '8', pqr: '9' },
            edfiDefaultDescriptor: 'uri://ed-fi.org/testDescriptorB1',
          },
        ];

        await prisma.bundleDescriptorMapping.createMany({
          data: bundleDescriptorMappings,
        });
        await prisma.customDescriptorMapping.createMany({
          data: bundleDescriptorMappings.map((mapping) => ({
            bundleKey: mapping.bundleKey,
            descriptorType: mapping.descriptorType,
            leftHandSideColumns: mapping.leftHandSideColumns,
            edfiDefaultDescriptor: mapping.edfiDefaultDescriptor,
            partnerId: tenantA.partnerId,
            customDescriptor: `custom_${mapping.edfiDefaultDescriptor}`,
          })),
        });
      });

      it('should return custom descriptor mappings if they exist for the partner', async () => {
        const resA = await request(app.getHttpServer())
          .get(endpointA)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(resA.status).toBe(200);

        const mappings = resA.body.customDescriptorMappings;
        expect(Object.keys(mappings)).toHaveLength(2);
        const descriptorAMappings = mappings[testDescriptorTypeA];
        expect(descriptorAMappings).toHaveLength(2);
        expect(descriptorAMappings).toContainEqual({
          v_other_columns: { abc: '1', def: '2', ghi: '3' },
          edfi_descriptor: 'uri://ed-fi.org/testDescriptorA1',
          local_descriptor: 'custom_uri://ed-fi.org/testDescriptorA1',
        });
        expect(descriptorAMappings).toContainEqual({
          v_other_columns: { abc: '4', def: '5', ghi: '6' },
          edfi_descriptor: 'uri://ed-fi.org/testDescriptorA2',
          local_descriptor: 'custom_uri://ed-fi.org/testDescriptorA2',
        });

        const descriptorBMappings = mappings[testDescriptorTypeB];
        expect(descriptorBMappings).toHaveLength(1);
        expect(descriptorBMappings).toContainEqual({
          v_other_columns: { jkl: '7', mno: '8', pqr: '9' },
          edfi_descriptor: 'uri://ed-fi.org/testDescriptorB1',
          local_descriptor: 'custom_uri://ed-fi.org/testDescriptorB1',
        });
      });

      it('should allow mappings to null', async () => {
        await prisma.customDescriptorMapping.update({
          where: {
            partnerId_bundleKey_descriptorType_leftHandSideColumns_edfiDefaultDescriptor: {
              partnerId: tenantA.partnerId,
              bundleKey: bundleA.path,
              descriptorType: testDescriptorTypeA,
              leftHandSideColumns: { abc: '1', def: '2', ghi: '3' },
              edfiDefaultDescriptor: 'uri://ed-fi.org/testDescriptorA1',
            },
          },
          data: {
            customDescriptor: null,
          },
        });

        const resA = await request(app.getHttpServer())
          .get(endpointA)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(resA.status).toBe(200);
        expect(resA.body.customDescriptorMappings[testDescriptorTypeA]).toContainEqual({
          v_other_columns: { abc: '1', def: '2', ghi: '3' },
          edfi_descriptor: 'uri://ed-fi.org/testDescriptorA1',
          local_descriptor: null,
        });
      });
      it('should return null for custom descriptors if they do not exist for the partner', async () => {
        const resX = await request(app.getHttpServer())
          .get(endpointX)
          .set('Authorization', `Bearer ${tokenX}`);
        expect(resX.status).toBe(200);
        expect(resX.body.customDescriptorMappings).toBeNull();
      });

      it('should include the descriptor namespace if it exists for the partner and not otherwise', async () => {
        const resA = await request(app.getHttpServer())
          .get(endpointA)
          .set('Authorization', `Bearer ${tokenA}`);
        const resX = await request(app.getHttpServer())
          .get(endpointX)
          .set('Authorization', `Bearer ${tokenX}`);

        expect(resA.status).toBe(200);
        expect(resX.status).toBe(200);

        const descriptorNamespaceA = resA.body.inputParams.DESCRIPTOR_NAMESPACE;
        const descriptorNamespaceX = resX.body.inputParams.DESCRIPTOR_NAMESPACE;

        expect(descriptorNamespaceA).toBeDefined();
        expect(descriptorNamespaceA).toBe(partnerA.descriptorNamespace); // included in seed for partner A
        expect(descriptorNamespaceX).toBeUndefined(); // not included in seed for partner X
      });
    });

  });

  describe('GET /:runId/roster', () => {
    let runA: Run;
    let endpointA: string;
    let tokenA: string;

    beforeEach(async () => {
      const authService = app.get(EarthbeamApiAuthService);
      const jobA = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });
      runA = jobA.runs[0];
      endpointA = `/earthbeam/jobs/${runA.id}/roster`;
      tokenA = await authService.createAccessToken({ runId: runA.id });
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app.getHttpServer()).get(endpointA);
      expect(res.status).toBe(401);
    });

    it('returns 409 when the partner has cross-year matching disabled', async () => {
      // partnerA defaults to crossYearMatchingEnabled=false
      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(409);
    });

    it('returns 500 when EDU creds are missing for an otherwise-enabled partner', async () => {
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: true },
      });
      // No creds → pool creation will fail before any rows are written;
      // controller's headersSent check should convert that to a clean 500
      // rather than tearing the socket.
      const configService = app.get(AppConfigService);
      const getInfoSpy = jest
        .spyOn(configService, 'getEduConnectionInfo')
        .mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(500);

      getInfoSpy.mockRestore();
    });

    describe('streaming responses', () => {
      // Streaming parser for supertest: collects chunks as they arrive and
      // signals whether the response ended cleanly ('end' fired) or was closed
      // early ('close'/'error' fired first). Use .buffer(true).parse(streamParser).
      const streamParser = (
        response: request.Response,
        cb: (err: Error | null, body: { chunks: Buffer[]; complete: boolean }) => void
      ) => {
        const chunks: Buffer[] = [];
        let settled = false;
        const settle = (complete: boolean) => {
          if (settled) return;
          settled = true;
          cb(null, { chunks, complete });
        };
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => settle(true));
        response.on('close', () => settle(false));
        response.on('error', () => settle(false));
      };

      // Stub EduSnowflakePoolService.use with a fake connection that streams
      // `source` rows. Caller is responsible for `mockRestore()`.
      const mockEduPoolStream = (source: Iterable<unknown> | AsyncIterable<unknown>) => {
        const eduPool = app.get(EduSnowflakePoolService);
        return jest.spyOn(eduPool, 'use').mockImplementation(async (_partnerId, cb) => {
          return cb({
            execute: () => ({ streamRows: () => Readable.from(source) }),
          } as never);
        });
      };

      beforeEach(async () => {
        await global.prisma.partner.update({
          where: { id: partnerA.id },
          data: { crossYearMatchingEnabled: true },
        });
      });

      it('streams the rows from the EDU pool as NDJSON', async () => {
        const rows = [
          { studentUniqueId: '1', priorYear: 2024 },
          { studentUniqueId: '2', priorYear: 2024 },
          { studentUniqueId: '3', priorYear: 2024 },
        ];
        const spy = mockEduPoolStream(rows);

        const res = await request(app.getHttpServer())
          .get(endpointA)
          .set('Authorization', `Bearer ${tokenA}`)
          .buffer(true)
          .parse(streamParser);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/x-ndjson');
        expect(res.body.complete).toBe(true);
        const body = Buffer.concat(res.body.chunks).toString('utf8');
        expect(body).toBe(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

        spy.mockRestore();
      });

      it('closes the response abruptly when the Snowflake row stream errors mid-flight', async () => {
        const spy = mockEduPoolStream(
          (async function* () {
            yield { studentUniqueId: '1' };
            throw new Error('snowflake exploded mid-stream');
          })()
        );

        const res = await request(app.getHttpServer())
          .get(endpointA)
          .set('Authorization', `Bearer ${tokenA}`)
          .buffer(true)
          .parse(streamParser);

        // Pipeline destroys the response on stream error. Headers were
        // already sent, so the status is 200, but the socket closes before
        // 'end' fires — streamParser surfaces that as complete: false.
        expect(res.status).toBe(200);
        expect(res.body.complete).toBe(false);
        const body = Buffer.concat(res.body.chunks).toString('utf8');
        expect(body).toBe(JSON.stringify({ studentUniqueId: '1' }) + '\n');

        spy.mockRestore();
      });
    });

    it('returns 500 when pool acquisition fails before any bytes are streamed', async () => {
      await global.prisma.partner.update({
        where: { id: partnerA.id },
        data: { crossYearMatchingEnabled: true },
      });

      const eduPool = app.get(EduSnowflakePoolService);
      const poolUseSpy = jest
        .spyOn(eduPool, 'use')
        .mockRejectedValue(new Error('pool acquisition failed'));

      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(500);

      poolUseSpy.mockRestore();
    });
  });

  describe('GET /:runId/identity-service', () => {
    let runA: Run;
    let endpointA: string;
    let tokenA: string;
    let runX: Run;
    let tokenX: string;
    let configService: AppConfigService;
    let fetchSpy: jest.SpyInstance;

    const tokenResponse = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body } as Response);

    // One base for the whole deployment; partners are addressed within it by
    // the path segments below.
    const idrsBaseUrl = 'https://idrs.example.test';

    // The executor calls the returned URL as-is, so it is the full search
    // route under that base.
    const searchUrl = (tenant: typeof tenantA) =>
      `${idrsBaseUrl}/partners/${tenant.partnerId}/tenants/${tenant.code}/students/search`;

    beforeEach(async () => {
      const authService = app.get(EarthbeamApiAuthService);

      const jobA = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
        idMatchingMode: 'fuzzy',
      });
      runA = jobA.runs[0];
      endpointA = `/earthbeam/jobs/${runA.id}/identity-service`;
      tokenA = await authService.createAccessToken({ runId: runA.id });

      const jobX = await seedJob({
        odsConfig: odsConfigX2425,
        bundle: bundleX,
        tenant: tenantX,
        idMatchingMode: 'fuzzy',
      });
      runX = jobX.runs[0];
      tokenX = await authService.createAccessToken({ runId: runX.id });

      // Tokens are cached per app instance, and the app is shared across tests.
      const idrsCredentials = app.get(IdrsCredentialsService);
      (idrsCredentials as unknown as { cache: Map<string, unknown> }).cache.clear();

      // Stub at the config boundary so the real token service, controller and
      // error mapping all run; only AWS and the OAuth server are faked.
      configService = app.get(AppConfigService);
      jest
        .spyOn(configService, 'idrsOauthTokenUrl')
        .mockReturnValue('https://auth.example.test/oauth/token');
      jest.spyOn(configService, 'idrsUrl').mockReturnValue(idrsBaseUrl);
      jest
        .spyOn(configService, 'getIdrsConnectionInfo')
        .mockImplementation(async (partnerId: string) => ({
          clientId: `${partnerId}-client`,
          clientSecret: `${partnerId}-secret`,
        }));
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          tokenResponse({ access_token: 'issued-token', expires_in: 24 * 60 * 60 })
        );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app.getHttpServer()).get(endpointA);
      expect(res.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // runX belongs to tenantX, under a different partner than tenantA — the
    // case the run-scoped token exists to stop, since a token that travelled
    // between runs of one partner would leak nothing new.
    it("rejects a token minted for another partner's run", async () => {
      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenX}`);
      expect(res.status).toBe(403);
      expect(configService.getIdrsConnectionInfo).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns the token and url for the run's partner", async () => {
      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        token: 'issued-token',
        url: searchUrl(tenantA),
      });

      // The response url is built from the run, so only the OAuth request
      // shows whose credentials minted the token: the callback has to have
      // resolved the run to partner A to reach partner A's client.
      expect(configService.getIdrsConnectionInfo).toHaveBeenCalledWith(tenantA.partnerId);
      const body = new URLSearchParams(fetchSpy.mock.calls[0][1].body.toString());
      expect(body.get('client_id')).toBe(`${tenantA.partnerId}-client`);
      expect(body.get('scope')).toBe(`student:identity:read partner:${tenantA.partnerId}`);
      expect(body.get('audience')).toBe(idrsBaseUrl);
    });

    // The base URL is configured verbatim (it doubles as the OAuth audience),
    // so it may or may not carry a trailing slash.
    it('joins the search route cleanly onto a base url with a trailing slash', async () => {
      jest.spyOn(configService, 'idrsUrl').mockReturnValue(`${idrsBaseUrl}/`);

      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.url).toBe(searchUrl(tenantA));
    });

    // Every failure is one response; humans diagnose from the log, not the
    // status. Cover an expected token-service error and a foreign AWS error.
    // OAuth rejection is exercised by the logging test below.
    it.each([
      [
        'the partner has no connection info',
        () => jest.spyOn(configService, 'getIdrsConnectionInfo').mockResolvedValue(null),
      ],
      [
        'Secrets Manager is unavailable',
        () =>
          jest
            .spyOn(configService, 'getIdrsConnectionInfo')
            .mockRejectedValue(new Error('ThrottlingException')),
      ],
    ])('returns 500 identity_service_unavailable when %s', async (_label, mockConnectionInfo) => {
      mockConnectionInfo();

      const res = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('identity_service_unavailable');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('never writes the token or the callback response to the app log', async () => {
      const logs: string[] = [];
      const capture = (message: unknown) => {
        logs.push(String(message));
      };
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);

      const ok = await request(app.getHttpServer())
        .get(endpointA)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(ok.status).toBe(200);

      fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);
      const failed = await request(app.getHttpServer())
        .get(`/earthbeam/jobs/${runX.id}/identity-service`)
        .set('Authorization', `Bearer ${tokenX}`);
      expect(failed.status).toBe(500);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const combined = logs.join('\n');
      // The log is where diagnosis happens, so it must carry the identifiers...
      expect(combined).toContain(`runId=${runA.id}`);
      expect(combined).toContain(`partnerId=${tenantX.partnerId}`);
      expect(combined).toContain('rejected with status 401');
      // ...and none of the credential material.
      expect(combined).not.toContain('issued-token');
      expect(combined).not.toContain('-secret');
      expect(combined).not.toContain('-client');
    });
  });

  describe('POST /:runId/status', () => {
    let runA: Run;
    let tokenA: string;
    let endpointA: string;

    beforeEach(async () => {
      const authService = app.get(EarthbeamApiAuthService);
      const jobA = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });


      runA = jobA.runs[0];
      tokenA = await authService.createAccessToken({ runId: runA.id });
      endpointA = `/earthbeam/jobs/${runA.id}/status`;
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app.getHttpServer()).post(endpointA);
      expect(res.status).toBe(401);
    });

    describe('Authenticated requests', () => {
      // TODO: full tests cases and tighten validation within EarthbeamApiStatusPayloadDto
    });

    describe('Complete Run', () => {
      // TODO: more tests re: run completion
      let eventEmitterMock: jest.SpyInstance;
      let fileServiceMock: Record<string, jest.Mock>;

      beforeEach(async () => {
        eventEmitterMock = jest.spyOn(EventEmitterLogService.prototype, 'emit');
        fileServiceMock = app.get(FileService) as unknown as Record<string, jest.Mock>;
      });

      afterEach(() => {
        eventEmitterMock.mockRestore();
      });

      it('should save output files from S3 listing', async () => {
        fileServiceMock.listFilesAtPath.mockResolvedValueOnce([
          { key: 'partner/tenant/2025/1/output/results.jsonl', name: 'results.jsonl' },
          { key: 'partner/tenant/2025/1/output/summary.csv', name: 'summary.csv' },
        ]);

        const res = await request(app.getHttpServer())
          .post(endpointA)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ action: 'done', status: 'success' });
        expect(res.status).toBe(201);

        const outputFiles = await prisma.runOutputFile.findMany({
          where: { runId: runA.id },
          orderBy: { name: 'asc' },
        });
        expect(outputFiles).toHaveLength(2);
        expect(outputFiles[0]).toMatchObject({
          name: 'results.jsonl',
          path: 'partner/tenant/2025/1/output/results.jsonl',
        });
        expect(outputFiles[1]).toMatchObject({
          name: 'summary.csv',
          path: 'partner/tenant/2025/1/output/summary.csv',
        });
      });

      describe('Slack Notifiction', () => {
        it('should send a slack notification when the run is complete', async () => {
          const res = await request(app.getHttpServer())
            .post(endpointA)
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ action: 'done', status: 'success' });

          expect(eventEmitterMock).toHaveBeenCalledWith(
            'run_complete',
            expect.objectContaining({
              // there's more to check, but just making sure we're sending something now
              summary: expect.any(String),
              runId: runA.id,
              jobId: runA.jobId,
              status: 'success',
            })
          );
        });

        it('should include user info if the job was initiated by a user', async () => {
          // Normally the created by user is populated in the DB by a PG trigger when the row is created,
          // but our seeding doesn't set up the context for the trigger to work. Eventually, I'd
          // like to have our seeds work well with the triggers, but there are some inconsistencies in
          // how those work that I'd like to iron out first. Until then, we'll set the user ad hoc in tests.
          await prisma.run.update({ where: { id: runA.id }, data: { createdById: userA.id } });

          await request(app.getHttpServer())
            .post(endpointA)
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ action: 'done', status: 'success' });

          expect(eventEmitterMock).toHaveBeenCalledWith(
            'run_complete',
            expect.objectContaining({
              metadata: expect.objectContaining({
                userName: userA.givenName + ' ' + userA.familyName,
                userEmail: userA.email,
              }),
            })
          );
        });

        it('should include client info for jobs intiated via the external API', async () => {
          // API client info pulled from job, not run (for now).
          await prisma.job.update({
            where: { id: runA.jobId },
            data: {
              apiIssuer: 'https://test-issuer.com',
              apiClientId: 'test-client-id',
              apiClientName: 'Test Client',
              createdById: null, // ensure this is null in case we update the seed to populate created by user
            },
          });

          await request(app.getHttpServer())
            .post(endpointA)
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ action: 'done', status: 'success' });

          expect(eventEmitterMock).not.toHaveBeenCalledWith(
            'run_complete',
            expect.objectContaining({
              metadata: expect.objectContaining({
                userName: expect.any(String),
              }),
            })
          );

          expect(eventEmitterMock).toHaveBeenCalledWith(
            'run_complete',
            expect.objectContaining({
              metadata: expect.objectContaining({
                apiClientName: 'Test Client',
              }),
            })
          );
        });
      });
    });
  });

  describe('POST /:runId/output-files', () => {
    let runA: Run;
    let tokenA: string;
    let endpointA: string;
    let jobA: Awaited<ReturnType<typeof seedJob>>;
    let fileBasePath: string;
    let fileServiceMock: Record<string, jest.Mock>;

    beforeEach(async () => {
      const authService = app.get(EarthbeamApiAuthService);
      fileServiceMock = app.get(FileService) as unknown as Record<string, jest.Mock>;

      jobA = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });


      runA = jobA.runs[0];
      tokenA = await authService.createAccessToken({ runId: runA.id });
      endpointA = `/earthbeam/jobs/${runA.id}/output-files`;
      fileBasePath = jobA.fileBasePath!;
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app.getHttpServer()).post(endpointA);
      expect(res.status).toBe(401);
    });

    it('should reject requests if the token does not match the run id', async () => {
      const authService = app.get(EarthbeamApiAuthService);
      const jobX = await seedJob({
        odsConfig: odsConfigX2425,
        bundle: bundleX,
        tenant: tenantX,
      });

      const tokenX = await authService.createAccessToken({ runId: jobX.runs[0].id });

      const res = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenX}`)
        .send({ path: `${fileBasePath}/output/sideloaded`, sentToOds: false });
      expect(res.status).toBe(403);
    });

    it('should reject paths outside the job data directory', async () => {
      const res = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: 'other-partner/other-tenant/other-year/other-job/output/evil', sentToOds: true });
      expect(res.status).toBe(400);
    });

    it('should reject sibling paths that share the fileBasePath prefix', async () => {
      const res = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: `${fileBasePath}-evil`, sentToOds: true });
      expect(res.status).toBe(400);
    });

    it('should reject the bare base path (must be a child)', async () => {
      const res = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: fileBasePath, sentToOds: true });
      expect(res.status).toBe(400);
    });

    it('should reject the bare base path with trailing slash', async () => {
      const res = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: `${fileBasePath}/`, sentToOds: true });
      expect(res.status).toBe(400);
    });

    it('should reject when no files are found at the given path', async () => {
      fileServiceMock.listFilesAtPath.mockResolvedValueOnce([]);

      const res = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: `${fileBasePath}/output/empty`, sentToOds: true });
      expect(res.status).toBe(400);
    });

    it('should canonicalize trailing slashes and store the path without them', async () => {
      const subfolder = `${jobA.fileBasePath}/output/transformed/`;
      fileServiceMock.listFilesAtPath.mockResolvedValueOnce([
        { key: `${subfolder}output1.jsonl`, name: 'output1.jsonl' },
      ]);

      const res = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: `${fileBasePath}/output/transformed/`, sentToOds: true });

      expect(res.status).toBe(201);

      const saved = await prisma.runOutputFileSet.findUnique({
        where: { uid: res.body.uid },
      });
      expect(saved!.path).toBe(`${fileBasePath}/output/transformed`);
    });

    it('should list S3 at the given path and save discovered files', async () => {
      const subfolder = `${jobA.fileBasePath}/output/transformed/`;
      fileServiceMock.listFilesAtPath.mockResolvedValueOnce([
        { key: `${subfolder}output1.jsonl`, name: 'output1.jsonl' },
        { key: `${subfolder}output2.jsonl`, name: 'output2.jsonl' },
      ]);

      const res = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: `${fileBasePath}/output/transformed`, sentToOds: true });

      expect(res.status).toBe(201);
      expect(res.body.uid).toBeDefined();
      expect(typeof res.body.uid).toBe('string');

      expect(fileServiceMock.listFilesAtPath).toHaveBeenCalledWith(subfolder);

      const saved = await prisma.runOutputFileSet.findUnique({
        where: { uid: res.body.uid },
      });
      expect(saved).not.toBeNull();
      expect(saved!.runId).toBe(runA.id);
      expect(saved!.path).toBe(`${fileBasePath}/output/transformed`);
      expect(saved!.files).toEqual(['output1.jsonl', 'output2.jsonl']);
      expect(saved!.sentToOds).toBe(true);
    });

    it('should return 409 on duplicate run_id + path', async () => {
      const subfolder = `${jobA.fileBasePath}/output/sideloaded/`;
      fileServiceMock.listFilesAtPath.mockResolvedValue([
        { key: `${subfolder}output1.jsonl`, name: 'output1.jsonl' },
      ]);

      const first = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: `${fileBasePath}/output/sideloaded`, sentToOds: false });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post(endpointA)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ path: `${fileBasePath}/output/sideloaded`, sentToOds: false });
      expect(second.status).toBe(409);
    });
  });

});
