import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';
import request from 'supertest';
import { seedJob } from '../factories/job-factory';
import { bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import { odsConnA2425, odsConnX2425 } from '../fixtures/context-fixtures/ods-fixture';
import { tenantA, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { Run } from '@prisma/client';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { EventEmitterService } from 'api/src/event-emitter/event-emitter.service';
import { userA } from '../fixtures/user-fixtures';

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
        odsConnection: odsConnA2425,
        bundle: bundleA,
        tenant: tenantA,
      });

      if (!jobA?.runs?.[0]) {
        throw new Error('Failed to seed job and run');
      }
      runA = jobA.runs[0];
      endpointA = `/earthbeam/jobs/${runA.id}`;
      tokenA = await authService.createAccessToken({ runId: runA.id });

      // Job X
      const jobX = await seedJob({
        odsConnection: odsConnX2425,
        bundle: bundleX,
        tenant: tenantX,
      });
      if (!jobX?.runs?.[0]) {
        throw new Error('Failed to seed job and run');
      }
      runX = jobX.runs[0];
      endpointX = `/earthbeam/jobs/${runX.id}`;
      tokenX = await authService.createAccessToken({ runId: runX.id });
    });

    afterEach(async () => {
      await prisma.job.deleteMany({
        where: { id: { in: [runA.jobId, runX.jobId] } },
      });
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

      afterEach(async () => {
        await prisma.bundleDescriptorMapping.deleteMany(); // cascade to custom descriptor mappings
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

  describe('POST /:runId/status', () => {
    let runA: Run;
    let tokenA: string;
    let endpointA: string;

    beforeEach(async () => {
      const authService = app.get(EarthbeamApiAuthService);
      const jobA = await seedJob({
        odsConnection: odsConnA2425,
        bundle: bundleA,
        tenant: tenantA,
      });

      if (!jobA?.runs?.[0]) {
        throw new Error('Failed to seed job and run');
      }
      runA = jobA.runs[0];
      tokenA = await authService.createAccessToken({ runId: runA.id });
      endpointA = `/earthbeam/jobs/${runA.id}/status`;
    });

    afterEach(async () => {
      await prisma.job.deleteMany({
        where: { id: { in: [runA.jobId] } },
      });
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

      beforeEach(async () => {
        // let eventEmitter = app.get(EventEmitterService);
        eventEmitterMock = jest.spyOn(EventEmitterService.prototype, 'emit');
      });

      afterEach(() => {
        eventEmitterMock.mockRestore();
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
                apiIssuer: 'https://test-issuer.com',
                apiClientId: 'test-client-id',
                apiClientName: 'Test Client',
              }),
            })
          );
        });
      });
    });
  });
});
