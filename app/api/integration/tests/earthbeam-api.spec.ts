import { Logger } from '@nestjs/common';
import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import { EduSnowflakePoolService } from 'api/src/earthbeam/api/edu-snowflake-pool.service';
import { AppConfigService } from 'api/src/config/app-config.service';
import { Readable } from 'node:stream';
import request from 'supertest';
import { omit } from 'lodash';
import { seedJob } from '../factories/job-factory';
import { bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import { odsConfigA2425, odsConfigX2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { Run, RunStatus } from '@prisma/client';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { EventEmitterLogService, EVENT_EMITTER_SERVICE } from 'api/src/event-emitter/event-emitter.service';
import { userA } from '../fixtures/user-fixtures';
import { FileService } from 'api/src/files/file.service';
import { stubIdrsConfig } from '../helpers/stub-idrs';
import { reportMatchResults } from '../helpers/report-match-results';
import { StudentRosterDetailsJson } from '@edanalytics/models';

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
        expect(res.body.appUrls.studentMatchResults).toBeUndefined();
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
          expect(res.body.appUrls.studentMatchResults).toContain(
            `/earthbeam/jobs/${run.id}/student-match-results`
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

    describe('run kinds', () => {
      /** The job's school year, 2024–25, by its end year. */
      const JOB_YEAR = 2025;

      type SavedMatch = {
        correlationId: string;
        basis: 'suggestion' | 'search';
        /** The basis's roster details' school_years, as IDRS returned them. */
        schoolYears: StudentRosterDetailsJson['school_years'];
      };

      const payloadOf = async (runId: number) => {
        const token = await app.get(EarthbeamApiAuthService).createAccessToken({ runId });
        return request(app.getHttpServer())
          .get(`/earthbeam/jobs/${runId}`)
          .set('Authorization', `Bearer ${token}`);
      };

      const callbackBaseOf = (runId: number) =>
        `${app.get(AppConfigService).executorCallbackBaseUrl()}/api/earthbeam/jobs/${runId}`;

      /** The callbacks every run gets. */
      const callbackUrlsOf = (runId: number) => {
        const base = callbackBaseOf(runId);
        return {
          status: `${base}/status`,
          error: `${base}/error`,
          summary: `${base}/summary`,
          unmatchedIds: `${base}/unmatched-ids`,
          outputFiles: `${base}/output-files`,
        };
      };

      /**
       * A fuzzy job whose full run succeeded, with a saved match for each
       * student: to the one suggestion the full run reported for them, or,
       * where it reported none, to a student the reviewer found by searching.
       */
      const seedMatchedJob = async (matches: SavedMatch[]) => {
        const job = await seedJob({
          odsConfig: odsConfigA2425,
          bundle: bundleA,
          tenant: tenantA,
          idMatchingMode: 'fuzzy',
          runStatus: 'success',
        });
        const fullRun = job.runs[0];
        await reportMatchResults(
          fullRun.id,
          matches.map(({ correlationId, basis, schoolYears }) => ({
            correlation_id: correlationId,
            candidate: { first_name: 'Ada' },
            matches:
              basis === 'suggestion'
                ? [
                    {
                      student_unique_id: `SUID-${correlationId}`,
                      score: 0.9,
                      school_years: schoolYears,
                    },
                  ]
                : [],
          }))
        );
        for (const { correlationId, basis, schoolYears } of matches) {
          const decision = { jobId: job.id, correlationId, seq: 1, kind: 'match' } as const;
          if (basis === 'suggestion') {
            const { id: resultId } = await prisma.studentMatchResult.findUniqueOrThrow({
              where: {
                jobId_correlationId_runId: { jobId: job.id, correlationId, runId: fullRun.id },
              },
            });
            await prisma.studentMatchDecision.create({
              data: { ...decision, resultId, ordinal: 0, studentUniqueId: `SUID-${correlationId}` },
            });
          } else {
            await prisma.studentMatchDecision.create({
              data: {
                ...decision,
                studentUniqueId: `SUID-FOUND-${correlationId}`,
                searchDetails: { first_name: 'Ada' },
                rosterDetails: { school_years: schoolYears },
              },
            });
          }
        }
        return job;
      };

      /** A send run of these students' saved matches, recorded in the order given. */
      const seedSendRun = async (jobId: number, correlationIds: string[]) => {
        const run = await prisma.run.create({ data: { jobId, kind: 'send', status: 'new' } });
        for (const correlationId of correlationIds) {
          await prisma.sendRunDecision.create({
            data: { runId: run.id, jobId, correlationId, seq: 1 },
          });
        }
        return run;
      };

      it('gives a full run every step’s inputs, marked as a full run', async () => {
        const job = await seedJob({
          odsConfig: odsConfigA2425,
          bundle: bundleA,
          tenant: tenantA,
          idMatchingMode: 'fuzzy',
        });
        const fullRun = job.runs[0];

        const res = await payloadOf(fullRun.id);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          runType: 'full',
          appDataBasePath: 's3://test-bucket/test-base-path',
          inputFiles: { INPUT_FILE: job.files[0].nameInternal },
          inputParams: {
            API_YEAR: String(JOB_YEAR),
            DESCRIPTOR_NAMESPACE: partnerA.descriptorNamespace,
            FORMAT: 'Standard',
          },
          customDescriptorMappings: null,
          bundle: { path: bundleA.path, branch: 'main' },
          appUrls: {
            ...callbackUrlsOf(fullRun.id),
            identityService: `${callbackBaseOf(fullRun.id)}/identity-service`,
            studentMatchResults: `${callbackBaseOf(fullRun.id)}/student-match-results`,
          },
          crossYearMatchAvailable: false,
          idMatchingMode: 'fuzzy',
          sendToOds: true,
          assessmentDatastore: {
            apiYear: String(JOB_YEAR),
            url: '',
            clientId: 'test',
            clientSecret: expect.any(String),
          },
        });
      });

      it('gives a send run its job’s inputs, its run id and its decisions’ answers, and no matching callbacks', async () => {
        const job = await seedMatchedJob([
          { correlationId: 'corr-1', basis: 'suggestion', schoolYears: [JOB_YEAR] },
          { correlationId: 'corr-2', basis: 'search', schoolYears: [JOB_YEAR] },
          { correlationId: 'corr-3', basis: 'suggestion', schoolYears: [JOB_YEAR] },
        ]);
        // corr-3 went in an earlier submit's send run. This one's students are
        // recorded out of correlation-id order.
        await seedSendRun(job.id, ['corr-3']);
        const sendRun = await seedSendRun(job.id, ['corr-2', 'corr-1']);

        const full = await payloadOf(job.runs[0].id);
        const res = await payloadOf(sendRun.id);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          ...omit(full.body, 'runType', 'appUrls'),
          runType: 'send',
          appUrls: callbackUrlsOf(sendRun.id),
          send: {
            runId: sendRun.id,
            students: [
              { correlationId: 'corr-1', studentUniqueId: 'SUID-corr-1', isCrossYear: false },
              { correlationId: 'corr-2', studentUniqueId: 'SUID-FOUND-corr-2', isCrossYear: false },
            ],
          },
        });
      });

      it.each([true, false])(
        'tells a send run which answers are outside the job’s year, from the basis’s school years, with crossYearMatchingEnabled %s',
        async (crossYearMatchingEnabled) => {
          await prisma.partner.update({
            where: { id: partnerA.id },
            data: { crossYearMatchingEnabled },
          });
          const job = await seedMatchedJob([
            { correlationId: 'corr-1', basis: 'suggestion', schoolYears: [JOB_YEAR - 1, JOB_YEAR] },
            { correlationId: 'corr-2', basis: 'suggestion', schoolYears: [JOB_YEAR - 1] },
            { correlationId: 'corr-3', basis: 'search', schoolYears: [JOB_YEAR] },
            { correlationId: 'corr-4', basis: 'search', schoolYears: [JOB_YEAR + 1] },
          ]);
          const sendRun = await seedSendRun(job.id, ['corr-1', 'corr-2', 'corr-3', 'corr-4']);

          const res = await payloadOf(sendRun.id);

          expect(
            res.body.send.students.map(
              ({ correlationId, isCrossYear }: Record<string, unknown>) => [
                correlationId,
                isCrossYear,
              ]
            )
          ).toEqual([
            ['corr-1', false],
            ['corr-2', true],
            ['corr-3', false],
            ['corr-4', true],
          ]);
        }
      );

      // Submit refuses such a match, so the test seeds one directly to pin the
      // backstop.
      it('fails a send run’s payload when a match’s school years are missing', async () => {
        const job = await seedMatchedJob([
          { correlationId: 'corr-1', basis: 'suggestion', schoolYears: undefined },
        ]);
        const sendRun = await seedSendRun(job.id, ['corr-1']);

        const res = await payloadOf(sendRun.id);

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
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

  describe('GET auth/:runId/init', () => {
    /** The Executor's init call, with the run's init token. */
    const init = async (runId: number) => {
      const token = await app.get(EarthbeamApiAuthService).createInitToken({ runId });
      return request(app.getHttpServer())
        .get(`/earthbeam/auth/${runId}/init`)
        .set('Authorization', `Bearer ${token}`);
    };

    it('starts a new run', async () => {
      const job = await seedJob({ odsConfig: odsConfigA2425, bundle: bundleA, tenant: tenantA });

      const res = await init(job.runs[0].id);

      expect(res.status).toBe(200);
      const run = await prisma.run.findUniqueOrThrow({ where: { id: job.runs[0].id } });
      expect(run.status).toBe('running');
    });

    // Its init token has been used, or the run failed to launch.
    it.each<RunStatus>(['running', 'error'])(
      'refuses a run that is %s, leaving it as it was',
      async (runStatus) => {
        const job = await seedJob({
          odsConfig: odsConfigA2425,
          bundle: bundleA,
          tenant: tenantA,
          runStatus,
        });

        const res = await init(job.runs[0].id);

        expect(res.status).toBe(401);
        const run = await prisma.run.findUniqueOrThrow({ where: { id: job.runs[0].id } });
        expect(run.status).toBe(runStatus);
      }
    );
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

      // The real token service, controller and error mapping all run.
      configService = stubIdrsConfig({
        idrsUrl: idrsBaseUrl,
        tokenUrl: 'https://auth.example.test/oauth/token',
      });
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

      it('records the files in output/ for a full run, and none for a send run', async () => {
        const sendRun = await prisma.run.create({
          data: { jobId: runA.jobId, kind: 'send', status: 'running' },
        });
        const sendToken = await app
          .get(EarthbeamApiAuthService)
          .createAccessToken({ runId: sendRun.id });
        fileServiceMock.listFilesAtPath.mockResolvedValueOnce([
          { key: 'test-base-path/output/results.jsonl', name: 'results.jsonl' },
        ]);

        // The send run completes first, so if it listed output/ it would take these files.
        const sendRes = await request(app.getHttpServer())
          .post(`/earthbeam/jobs/${sendRun.id}/status`)
          .set('Authorization', `Bearer ${sendToken}`)
          .send({ action: 'done', status: 'success' });
        expect(sendRes.status).toBe(201);
        const fullRes = await request(app.getHttpServer())
          .post(endpointA)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ action: 'done', status: 'success' });
        expect(fullRes.status).toBe(201);

        expect(await prisma.runOutputFile.findMany({ where: { runId: runA.id } })).toMatchObject([
          { name: 'results.jsonl', path: 'test-base-path/output/results.jsonl' },
        ]);
        expect(await prisma.runOutputFile.findMany({ where: { runId: sendRun.id } })).toEqual([]);
      });

      // The job page polls until the run's `done` update appears, and a retried
      // `done` is refused once the run is final, so the update must be
      // recorded with the status, before anything that can fail.
      it('records a done with its status even when listing the output files fails', async () => {
        fileServiceMock.listFilesAtPath.mockRejectedValueOnce(new Error('S3 is unavailable'));

        const res = await request(app.getHttpServer())
          .post(endpointA)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ action: 'done', status: 'success' });

        expect(res.status).toBe(500);
        expect(await prisma.run.findUniqueOrThrow({ where: { id: runA.id } })).toMatchObject({
          status: 'success',
        });
        expect(
          (await prisma.runUpdate.findMany({ where: { runId: runA.id } })).map(
            ({ action, status }) => [action, status]
          )
        ).toEqual([['done', 'success']]);
      });

      // A run's `success` or `error` is final. A late `done` that contradicts
      // it would let a run counted as failed, and so resent, count as
      // delivered too.
      it.each([
        ['failure', 'error', 'success'],
        ['success', 'success', 'failure'],
      ])(
        'refuses a done after done/%s, leaving the run %s, with no event, listing or update',
        async (first, runStatus, second) => {
          const done = (status: string) =>
            request(app.getHttpServer())
              .post(endpointA)
              .set('Authorization', `Bearer ${tokenA}`)
              .send({ action: 'done', status });

          /** What completing a run produces: its event and its output-file listing. */
          const effects = () => ({
            events: eventEmitterMock.mock.calls.filter(([name]) => name === 'run_complete').length,
            listings: fileServiceMock.listFilesAtPath.mock.calls.length,
          });

          expect((await done(first)).status).toBe(201);
          const afterFirst = effects();
          const res = await done(second);

          expect(res.status).toBe(409);
          expect(await prisma.run.findUniqueOrThrow({ where: { id: runA.id } })).toMatchObject({
            status: runStatus,
          });
          expect(effects()).toEqual(afterFirst);
          expect(
            (await prisma.runUpdate.findMany({ where: { runId: runA.id } })).map(
              ({ action, status }) => [action, status]
            )
          ).toEqual([['done', first]]);
        }
      );

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

        it('marks a full run’s event with its kind, leaving its summary as it was', async () => {
          const job = await prisma.job.findUniqueOrThrow({ where: { id: runA.jobId } });

          await request(app.getHttpServer())
            .post(endpointA)
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ action: 'done', status: 'success' });

          const [, payload] = eventEmitterMock.mock.calls.find(([name]) => name === 'run_complete');
          expect(payload.runType).toBe('full');
          expect(payload.summary.startsWith(`${job.name} (`)).toBe(true);
        });

        it('marks a send run’s event with its kind, and says so in its summary', async () => {
          const sendRun = await prisma.run.create({
            data: { jobId: runA.jobId, kind: 'send', status: 'running' },
          });
          const sendToken = await app
            .get(EarthbeamApiAuthService)
            .createAccessToken({ runId: sendRun.id });

          await request(app.getHttpServer())
            .post(`/earthbeam/jobs/${sendRun.id}/status`)
            .set('Authorization', `Bearer ${sendToken}`)
            .send({ action: 'done', status: 'success' });

          const [, payload] = eventEmitterMock.mock.calls.find(([name]) => name === 'run_complete');
          expect(payload).toMatchObject({ runId: sendRun.id, runType: 'send' });
          expect(payload.summary).toMatch(/^send run: /);
        });

        it('should report reportable resource errors and the input params', async () => {
          // bundleA reports studentAssessments only, so students' failures don't count.
          await prisma.run.update({
            where: { id: runA.id },
            data: {
              summary: {
                studentAssessments: {
                  records_processed: 10,
                  records_skipped: 1,
                  records_failed: 2,
                },
                students: { records_processed: 5, records_failed: 5 },
              },
            },
          });
          const { inputParams } = await prisma.job.findUniqueOrThrow({ where: { id: runA.jobId } });

          await request(app.getHttpServer())
            .post(endpointA)
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ action: 'done', status: 'success' });

          const [, payload] = eventEmitterMock.mock.calls.find(([name]) => name === 'run_complete');
          expect(payload.completedWithErrors).toBe(true);
          expect(payload.result.hasResourceErrors).toBe(true);
          expect(payload.summary).toContain('studentAssessments (2/10)');
          expect(payload.summary).not.toContain('students (');
          expect(payload.input.params).toEqual(
            inputParams?.map(({ name, value }) => ({ name, value }))
          );
        });

        it('should report unmatched students from the count the Executor sent', async () => {
          await prisma.run.update({
            where: { id: runA.id },
            data: {
              unmatchedStudentsInfo: { name: 'student_id', type: 'studentUniqueId', count: 3 },
            },
          });

          await request(app.getHttpServer())
            .post(endpointA)
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ action: 'done', status: 'success' });

          const [, payload] = eventEmitterMock.mock.calls.find(([name]) => name === 'run_complete');
          expect(payload.completedWithErrors).toBe(true);
          expect(payload.result.hasUnmatchedStudents).toBe(true);
          expect(payload.unmatchedStudentsCount).toBe(3);
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
