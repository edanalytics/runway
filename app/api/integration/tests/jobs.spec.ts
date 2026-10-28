import request from 'supertest';
import { sessionCookie } from '../helpers/session/session-cookie';
import sessionStore from '../helpers/session/session-store';
import {
  tenantA,
  tenantDGlobal,
  tenantEGlobal,
  tenantB,
  tenantX,
} from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB, userX } from '../fixtures/user-fixtures';
import { sessionData } from '../helpers/session/session-factory';
import {
  odsConfigA2425,
  odsConfigB2526,
  odsConfigX2425,
} from '../fixtures/context-fixtures/ods-fixture';
import { allBundles, bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import { makePostJobDto } from '../factories/job-input-factory';
import { makeJobTemplate } from '../factories/job-template-factory';
import { EarthbeamBundlesService } from 'api/src/earthbeam/earthbeam-bundles.service';
import { GetJobDto, PostJobDto, toGetJobDto } from 'models/src/dtos/job.dto';
import { FileService } from 'api/src/files/file.service';
import { ExecutorAwsService } from 'api/src/earthbeam/executor/executor.aws.service';
import { noStudentsToMatch } from 'api/src/jobs/student-match-review.service';
import { seedJob } from '../factories/job-factory';
import { plainToInstance } from 'class-transformer';
import { sortBy } from 'lodash';
import { IdMatchingMode, Job, JobNote, RunKind, RunStatus } from '@prisma/client';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { schoolYear2425 } from '../fixtures/context-fixtures/school-year-fixtures';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { NOTE_CHAR_LIMIT } from 'models/src/constants';
import { AppConfigService as AppConfigService } from '../../src/config/app-config.service';
import { stubIdrsConfig } from '../helpers/stub-idrs';
import { holdJobRow } from '../helpers/db/hold-job-row';
import { waitUntilBlockedBy } from '../helpers/db/wait-until-blocked-by';

type SeededJob = Awaited<ReturnType<typeof seedJob>>;

describe('GET /jobs', () => {
  const endpoint = '/jobs';
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    const sessionA = sessionCookie('jobs-spec');
    const sessionX = sessionCookie('jobs-spec-x');

    let aJobs: SeededJob[] = [];
    beforeEach(async () => {
      // A starts with jobs, X starts with none
      await sessionStore.set(sessionA.sid, sessionData(userA, tenantA));
      await sessionStore.set(sessionX.sid, sessionData(userX, tenantX));
      aJobs = await Promise.all([
        seedJob({
          odsConfig: odsConfigA2425,
          bundle: bundleA,
          tenant: tenantA,
        }),
        seedJob({
          odsConfig: odsConfigA2425,
          bundle: bundleA,
          tenant: tenantA,
          summary: true,
          unmatchedStudentsInfo: true,
          outputFiles: true,
        }),
      ]);
    });

    it('should return an empty array if there are no jobs', async () => {
      // X has no jobs
      const resX = await request(app.getHttpServer())
        .get(endpoint)
        .set('Cookie', [sessionX.cookie]);
      expect(resX.status).toBe(200);
      expect(resX.body).toEqual([]);
    });

    it('should return sendToOds=false for no-ODS jobs', async () => {
      const noOdsJob = await seedJob({
        sendToOds: false,
        schoolYearId: '2324',
        bundle: bundleA,
        tenant: tenantA,
      });

      const res = await request(app.getHttpServer()).get(endpoint).set('Cookie', [sessionA.cookie]);

      const dto = res.body.find((j: GetJobDto) => j.id === noOdsJob.id);
      expect(dto).toBeDefined();
      expect(dto.sendToOds).toBe(false);
    });

    it('should match the expected values', async () => {
      const resA = await request(app.getHttpServer())
        .get(endpoint)
        .set('Cookie', [sessionA.cookie]);

      resA.body
        .map((j: unknown) => plainToInstance(GetJobDto, j))
        .forEach((jDto: GetJobDto) => {
          const original = aJobs.find((aj) => aj.id === jDto.id);
          if (!original) {
            throw new Error(`Job ${jDto.id} not found`);
          }

          expect(jDto.name).toBe(original?.name);
          expect(jDto.template).toEqual(original?.template);
          expect(jDto.schoolYearId).toBe(original?.schoolYearId);
          expect(jDto.inputParams).toEqual(original.inputParams);
          // expect(jDto.createdBy.id).toBe(original.createdById); // Not testing this at the moment given how createdBy is set from the PG trigger and the test suite doesn't use the request-scoped DB connections these expect
          expect(jDto.schoolYear.id).toBe(original.schoolYearId);
          expect(
            jDto.files.map((f) => ({
              path: f.path,
              nameFromUser: f.nameFromUser,
            }))
          ).toEqual(
            expect.arrayContaining(
              original?.files.map((f) => ({
                path: f.path,
                nameFromUser: f.nameFromUser,
              }))
            )
          );

          const lastRun = original?.runs
            ?.slice()
            .sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime())[0];
          if (!lastRun) {
            throw new Error(`Last run for job ${jDto.id} not found`);
          }

          jDto.runs.forEach((r) => {
            const originalRun = original?.runs?.find((ar) => ar.id === r.id);
            if (!originalRun) {
              throw new Error(`Run ${r.id} not found`);
            }

            expect(r.status).toBe(originalRun.status);
            expect(r.createdOn.getTime()).toEqual(originalRun.createdOn.getTime());
            expect(r.summary).toEqual(originalRun.summary);
            expect(r.unmatchedStudentsInfo ?? {}).toEqual(
              expect.objectContaining(originalRun.unmatchedStudentsInfo ?? {})
            );
          });
        });
    });

    it('should return a list of jobs for each tenant', async () => {
      const xJobs: SeededJob[] = [
        await seedJob({
          odsConfig: odsConfigX2425,
          bundle: bundleX,
          tenant: tenantX,
        }),
      ];

      const resA = await request(app.getHttpServer())
        .get(endpoint)
        .set('Cookie', [sessionA.cookie]);
      const resX = await request(app.getHttpServer())
        .get(endpoint)
        .set('Cookie', [sessionX.cookie]);

      expect(resA.status).toBe(200);
      expect(resX.status).toBe(200);

      expect(resA.body.length).toBe(aJobs.length);
      expect(resX.body.length).toBe(xJobs.length);

      expect(resA.body.map((j: GetJobDto) => j.id)).toEqual(
        expect.arrayContaining(aJobs.map((j) => j.id))
      );
      expect(resX.body.map((j: GetJobDto) => j.id)).toEqual(
        expect.arrayContaining(xJobs.map((j) => j.id))
      );
    });
  });
});

describe('GET /jobs/:id', () => {
  let endpointA: string;
  let endpointB: string;
  let jobA: SeededJob;
  let jobB: Job;
  let jobDGlobal: Job;
  let jobEGlobal: Job;

  beforeEach(async () => {
    [jobA, jobB, jobDGlobal, jobEGlobal] = await Promise.all([
      seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      }),
      seedJob({
        odsConfig: odsConfigB2526,
        bundle: bundleA, // same bundle for both tenants is fine
        tenant: tenantB,
      }),
      seedJob({
        odsConfig: odsConfigA2425, // same partner as tenantA/tenantB is fine
        bundle: bundleA,
        tenant: tenantDGlobal,
      }),
      seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantEGlobal,
      }),
    ]);
    endpointA = `/jobs/${jobA.id}`;
    endpointB = `/jobs/${jobB.id}`;
  });

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

    it('should return the job if the user is logged into the associated tenant', async () => {
      const resA = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieA]);
      expect(resA.status).toBe(200);
      expect(resA.body.id).toEqual(jobA.id);
      expect(resA.body.schoolYear).toEqual(schoolYear2425);
    });

    // The frontend picks the full run by its kind, to compute the job's status,
    // and reads each run's summary.
    it('returns each run’s kind and summary', async () => {
      // Only a fuzzy job has send runs, and only after a successful full run.
      const job = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
        idMatchingMode: 'fuzzy',
        runStatus: 'success',
      });
      const summary = {
        studentAssessments: { records_processed: 4, records_skipped: 0, records_failed: 1 },
      };
      const sendRun = await prisma.run.create({
        data: { jobId: job.id, kind: 'send', status: 'error', summary },
      });

      const res = await request(app.getHttpServer())
        .get(`/jobs/${job.id}`)
        .set('Cookie', [cookieA]);

      const runs = res.body.runs.map(
        ({ id, kind, summary }: { id: number; kind: RunKind; summary: unknown }) => ({
          id,
          kind,
          summary,
        })
      );
      expect(sortBy(runs, 'id')).toEqual([
        { id: job.runs[0].id, kind: 'full', summary: null },
        { id: sendRun.id, kind: 'send', summary },
      ]);
    });

    it('shows failed resources the bundle reports on as complete with errors', async () => {
      // bundleA reports studentAssessments only, so students' failures don't count.
      await prisma.run.updateMany({
        where: { jobId: jobA.id },
        data: {
          status: 'success',
          summary: {
            studentAssessments: { records_processed: 10, records_failed: 2 },
            students: { records_processed: 5, records_failed: 5 },
          },
        },
      });

      const res = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieA]);
      const job = plainToInstance(GetJobDto, res.body);

      expect(job.resourceErrors.map(({ resource }) => resource)).toEqual(['studentAssessments']);
      expect(job.status).toBe('complete with errors');
    });

    it('has no resource summaries when its run has no summary', async () => {
      const res = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieA]);
      const job = plainToInstance(GetJobDto, res.body);

      expect(job.resourceSummaries).toBeUndefined();
      expect(job.hasResourceErrors).toBe(false);
    });

    it('should return sendToOds=false for a no-ODS job', async () => {
      const noOdsJob = await seedJob({
        sendToOds: false,
        schoolYearId: '2324',
        bundle: bundleA,
        tenant: tenantA,
      });

      const res = await request(app.getHttpServer())
        .get(`/jobs/${noOdsJob.id}`)
        .set('Cookie', [cookieA]);
      expect(res.status).toBe(200);
      expect(res.body.sendToOds).toBe(false);
    });

    it('should reject requests for jobs that are not associated with the tenant', async () => {
      // user in Tenant B requests Job in Tenant A, user in Tenant A requests Job in Tenant B
      const resA = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieB]);
      const resB = await request(app.getHttpServer()).get(endpointB).set('Cookie', [cookieA]);
      expect(resA.status).toBe(403);
      expect(resB.status).toBe(403);
    });

    describe('metatenant access (route has @AllowMetatenant)', () => {
      const SUPPORT_ROLES = ['runway.test.user', 'runway.test.supportuser'];
      const USER_ROLE = 'runway.test.user';

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
            'global session tenant + resource owned by a different global tenant + no metatenant privilege -> forbidden',
          sessionTenant: tenantDGlobal,
          resourceJob: () => jobEGlobal,
          roles: USER_ROLE,
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
        {
          description:
            'non-global session tenant + non-global resource tenant (same partner) + no metatenant privilege -> forbidden',
          sessionTenant: tenantA,
          resourceJob: () => jobB,
          roles: USER_ROLE,
          expectedStatus: 403,
        },
        {
          description:
            'non-global session tenant + resource owned by a different global tenant + metatenant privilege -> forbidden',
          sessionTenant: tenantA,
          resourceJob: () => jobDGlobal,
          roles: SUPPORT_ROLES,
          expectedStatus: 403,
        },
        {
          description:
            'non-global session tenant + resource owned by a different global tenant + no metatenant privilege -> forbidden',
          sessionTenant: tenantA,
          resourceJob: () => jobDGlobal,
          roles: USER_ROLE,
          expectedStatus: 403,
        },
      ])('$description', async ({ sessionTenant, resourceJob, roles, expectedStatus }) => {
        const cookie = (await authHelper.login(idpA, userA, sessionTenant, roles)).cookies;

        const res = await request(app.getHttpServer())
          .get(`/jobs/${resourceJob().id}`)
          .set('Cookie', [cookie]);

        expect(res.status).toBe(expectedStatus);
      });
    });
  });
});

describe('GET /jobs/:id/output-files', () => {
  const SUPPORT_ROLES = ['runway.test.user', 'runway.test.supportuser'];
  const USER_ROLE = 'runway.test.user';
  const endpoint = (id: number) => `/jobs/${id}/output-files`;

  let jobA: SeededJob;
  let jobB: SeededJob;
  let jobEGlobal: SeededJob;

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
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint(jobA.id));
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
      const res = await request(app.getHttpServer())
        .get(endpoint(jobA.id))
        .set('Cookie', [cookieA]);
      expect(res.status).toBe(200);

      const expectedFiles = await prisma.runOutputFile.findMany({
        where: { run: { jobId: jobA.id } },
      });
      expect(res.body.map((f: { name: string }) => f.name)).toEqual(
        expect.arrayContaining(expectedFiles.map((f) => f.name))
      );
    });

    it('should reject requests from a user without the SupportUser role, even for their own tenant', async () => {
      const res = await request(app.getHttpServer())
        .get(endpoint(jobA.id))
        .set('Cookie', [nonSupportCookieA]);
      expect(res.status).toBe(403);
    });

    it('should reject requests for jobs that are not associated with the tenant', async () => {
      const resA = await request(app.getHttpServer())
        .get(endpoint(jobA.id))
        .set('Cookie', [cookieB]);
      const resB = await request(app.getHttpServer())
        .get(endpoint(jobB.id))
        .set('Cookie', [cookieA]);
      expect(resA.status).toBe(403);
      expect(resB.status).toBe(403);
    });

    it('should return 404 for a job that does not exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/jobs/999999999/output-files')
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
          .get(endpoint(resourceJob().id))
          .set('Cookie', [cookie]);

        expect(res.status).toBe(expectedStatus);
      });

      it('should return the output files for a job owned by a different tenant when the user is a SupportUser logged into a global tenant in the same partner', async () => {
        const cookie = (await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_ROLES)).cookies;

        const res = await request(app.getHttpServer())
          .get(endpoint(jobB.id))
          .set('Cookie', [cookie]);

        expect(res.status).toBe(200);
        const expectedFiles = await prisma.runOutputFile.findMany({
          where: { run: { jobId: jobB.id } },
        });
        expect(res.body.map((f: { name: string }) => f.name)).toEqual(
          expect.arrayContaining(expectedFiles.map((f) => f.name))
        );
      });
    });
  });
});

describe('GET /jobs/:id/output-files/*', () => {
  const USER_ROLE = 'runway.test.user';
  const SUPPORT_ROLES = ['runway.test.user', 'runway.test.supportuser'];
  const OTHER_FILE_NAME = 'summary.csv';
  const unmatchedEndpoint = (id: number) =>
    `/jobs/${id}/output-files/input_no_student_id_match.csv`;
  const otherFileEndpoint = (id: number, fileName: string) =>
    `/jobs/${id}/output-files/${fileName}`;

  // jobA belongs to tenantA, jobB to tenantB -- both non-global children of tenantDGlobal
  let jobA: SeededJob;
  let jobB: SeededJob;

  beforeEach(async () => {
    [jobA, jobB] = await Promise.all([
      seedJob({ odsConfig: odsConfigA2425, bundle: bundleA, tenant: tenantA }),
      seedJob({ odsConfig: odsConfigB2526, bundle: bundleA, tenant: tenantB }),
    ]);

    await Promise.all(
      [jobA, jobB].flatMap((job) => {
        const runId = job.runs![0].id;
        return [
          prisma.runOutputFile.create({
            data: {
              runId,
              name: 'input_no_student_id_match.csv',
              path: `output/${job.id}/input_no_student_id_match.csv`,
            },
          }),
          prisma.runOutputFile.create({
            data: { runId, name: OTHER_FILE_NAME, path: `output/${job.id}/${OTHER_FILE_NAME}` },
          }),
        ];
      })
    );
  });

  it('should reject unauthenticated requests', async () => {
    const resUnmatched = await request(app.getHttpServer()).get(unmatchedEndpoint(jobA.id));
    const resOther = await request(app.getHttpServer()).get(
      otherFileEndpoint(jobA.id, OTHER_FILE_NAME)
    );
    expect(resUnmatched.status).toBe(401);
    expect(resOther.status).toBe(401);
  });

  describe('the unmatched-students file', () => {
    it('is downloadable by a User in their login tenant', async () => {
      const cookie = (await authHelper.login(idpA, userA, tenantA, USER_ROLE)).cookies;
      const res = await request(app.getHttpServer())
        .get(unmatchedEndpoint(jobA.id))
        .set('Cookie', [cookie]);
      expect(res.status).toBe(200);
      expect(res.text).toBe(
        `s3-test-download-url://output/${jobA.id}/input_no_student_id_match.csv`
      );
    });

    it('is not downloadable by a User logged into a global tenant for a job in a child tenant', async () => {
      const cookie = (await authHelper.login(idpA, userA, tenantDGlobal, USER_ROLE)).cookies;
      const res = await request(app.getHttpServer())
        .get(unmatchedEndpoint(jobB.id))
        .set('Cookie', [cookie]);
      expect(res.status).toBe(403);
    });

    it('is downloadable by a SupportUser logged into a global tenant for a job in a child tenant', async () => {
      const cookie = (await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_ROLES)).cookies;
      const res = await request(app.getHttpServer())
        .get(unmatchedEndpoint(jobB.id))
        .set('Cookie', [cookie]);
      expect(res.status).toBe(200);
      expect(res.text).toBe(
        `s3-test-download-url://output/${jobB.id}/input_no_student_id_match.csv`
      );
    });
  });

  describe('other output files (dedicated job.output-files.read privilege required)', () => {
    it('is not downloadable by a User in their login tenant', async () => {
      const cookie = (await authHelper.login(idpA, userA, tenantA, USER_ROLE)).cookies;
      const res = await request(app.getHttpServer())
        .get(otherFileEndpoint(jobA.id, OTHER_FILE_NAME))
        .set('Cookie', [cookie]);
      expect(res.status).toBe(403);
    });

    it('is not downloadable by a User logged into a global tenant for a job in a child tenant', async () => {
      const cookie = (await authHelper.login(idpA, userA, tenantDGlobal, USER_ROLE)).cookies;
      const res = await request(app.getHttpServer())
        .get(otherFileEndpoint(jobB.id, OTHER_FILE_NAME))
        .set('Cookie', [cookie]);
      expect(res.status).toBe(403);
    });

    it('is downloadable by a SupportUser in their login tenant', async () => {
      const cookie = (await authHelper.login(idpA, userA, tenantA, SUPPORT_ROLES)).cookies;
      const res = await request(app.getHttpServer())
        .get(otherFileEndpoint(jobA.id, OTHER_FILE_NAME))
        .set('Cookie', [cookie]);
      expect(res.status).toBe(200);
      expect(res.text).toBe(`s3-test-download-url://output/${jobA.id}/${OTHER_FILE_NAME}`);
    });

    it('is downloadable by a SupportUser logged into a global tenant for a job in a child tenant', async () => {
      const cookie = (await authHelper.login(idpA, userA, tenantDGlobal, SUPPORT_ROLES)).cookies;
      const res = await request(app.getHttpServer())
        .get(otherFileEndpoint(jobB.id, OTHER_FILE_NAME))
        .set('Cookie', [cookie]);
      expect(res.status).toBe(200);
      expect(res.text).toBe(`s3-test-download-url://output/${jobB.id}/${OTHER_FILE_NAME}`);
    });
  });
});

describe('POST /jobs', () => {
  const endpoint = '/jobs';
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).post(endpoint);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    const sessionA = sessionCookie('jobs-spec');
    const jobTemplateA = makeJobTemplate(bundleA);
    const postJobDto = makePostJobDto(jobTemplateA, odsConfigA2425.schoolYearId);
    let getBundlesMock: jest.SpyInstance;

    beforeEach(async () => {
      await sessionStore.set(sessionA.sid, sessionData(userA, tenantA));
      getBundlesMock = jest
        .spyOn(EarthbeamBundlesService.prototype, 'getBundles')
        .mockResolvedValue(allBundles);
    });

    afterAll(async () => {
      getBundlesMock.mockRestore();
    });

    it('should accept requests with a valid PostJobDto', async () => {
      // validate that postJobDto succeeds so we know that other tests built
      // from it fail due to the change we make to postJobDto
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send(postJobDto);
      expect(res.status).toBe(201);

      const job = await prisma.job.findUnique({ where: { id: res.body.id } });
      expect(job?.odsId).toBe(odsConfigA2425.id);
      expect(job?.sendToOds).toBe(true);
    });

    it('stores the template from the bundle', async () => {
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send(postJobDto);

      const job = await prisma.job.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(job.template).toStrictEqual({
        name: 'bundle-a',
        path: 'bundle/a',
        files: [
          {
            name: 'Assessment data',
            templateKey: 'INPUT_FILE',
            isRequired: true,
            fileType: ['csv', 'txt'],
          },
        ],
        params: [
          { name: 'School Year', templateKey: 'API_YEAR', isRequired: true },
          {
            name: 'Reporting Data Format',
            templateKey: 'FORMAT',
            isRequired: true,
            allowedValues: ['Standard', 'End-of-Course', 'Alternate', 'End-of-Course Alternate'],
          },
        ],
        reportResources: ['studentAssessments'],
      });
    });

    it("snapshots the partner's matching mode onto the job", async () => {
      // The seeded partner is id_based, so the fuzzy value asserted below can
      // only have come from the update. Seed data is refreshed before each
      // test, so no reset is needed afterwards.
      const seeded = await prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } });
      expect(seeded.idMatchingMode).toBe('id_based');

      await prisma.partner.update({
        where: { id: partnerA.id },
        data: { idMatchingMode: 'fuzzy' },
      });

      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send(postJobDto);
      expect(res.status).toBe(201);

      const job = await prisma.job.findUnique({ where: { id: res.body.id } });
      expect(job?.idMatchingMode).toBe('fuzzy');
    });

    it.each(['fuzzy', 'id_based_fuzzy_background'])(
      'snapshots new jobs after an admin enables %s without changing existing jobs',
      async (mode) => {
        const admin = (await authHelper.login(idpA, userA, tenantA, 'runway.test.partneradmin'))
          .cookies;
        const create = () =>
          request(app.getHttpServer())
            .post(endpoint)
            .set('Cookie', [sessionA.cookie])
            .send(postJobDto);
        const original = await create();
        expect(original.status).toBe(201);
        stubIdrsConfig({
          idrsUrl: 'https://idrs.example.test',
          tokenUrl: 'https://auth.example.test/token',
        });
        jest.spyOn(global, 'fetch').mockImplementation(
          async (url) =>
            ({
              ok: true,
              status: 200,
              json: async () =>
                url === 'https://auth.example.test/token'
                  ? { access_token: 'token' }
                  : { scopes: [`partner:${partnerA.id}`, 'student:identity:read'] },
            } as Response)
        );
        try {
          const saved = await request(app.getHttpServer())
            .put('/partners/id-matching-mode')
            .set('Cookie', [admin])
            .send({ idMatchingMode: mode });
          expect(saved.status).toBe(200);
          const next = await create();
          expect(next.status).toBe(201);
          const rows = await prisma.job.findMany({
            where: { id: { in: [original.body.id, next.body.id] } },
            orderBy: { id: 'asc' },
          });
          expect(rows.map((job) => job.idMatchingMode)).toEqual(['id_based', mode]);

          // A failed enablement cannot change the mode used by subsequent jobs.
          jest.spyOn(app.get(AppConfigService), 'getIdrsConnectionInfo').mockResolvedValue(null);
          const rejected = await request(app.getHttpServer())
            .put('/partners/id-matching-mode')
            .set('Cookie', [admin])
            .send({ idMatchingMode: mode === 'fuzzy' ? 'id_based_fuzzy_background' : 'fuzzy' });
          expect(rejected.status).toBe(422);
          const afterFailure = await create();
          expect(afterFailure.status).toBe(201);
          expect(
            (await prisma.job.findUniqueOrThrow({ where: { id: afterFailure.body.id } }))
              .idMatchingMode
          ).toBe(mode);
        } finally {
          jest.restoreAllMocks();
        }
      }
    );

    it('should reject requests with an invalid PostJobDto', async () => {
      // confirm class validator is working
      const invalidPostJobDto: Partial<PostJobDto> = {
        ...postJobDto,
      };
      delete invalidPostJobDto.name;
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send(invalidPostJobDto);
      expect(res.status).toBe(400);
    });

    it('should reject requests with a bundle that does not exist', async () => {
      const jobInputWithNonExistantBundle: PostJobDto = {
        ...postJobDto,
        template: {
          ...postJobDto.template,
          path: 'does-not-exist',
        },
      };

      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send(jobInputWithNonExistantBundle);
      expect(res.status).toBe(400);
    });

    it('should reject requests with a bundle that is not enabled for the partner', async () => {
      const jobInputWithUnallowedBundle: PostJobDto = {
        ...postJobDto,
        template: makeJobTemplate(bundleX),
      };
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send(jobInputWithUnallowedBundle);
      expect(res.status).toBe(400);
    });

    it('should create a job without an ODS when the year is configured not to send to ODS', async () => {
      await prisma.schoolYearConfig.create({
        data: {
          partnerId: tenantA.partnerId,
          schoolYearId: '2324',
          isEnabled: true,
          sendToOds: false,
        },
      });

      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send({
          ...postJobDto,
          schoolYearId: '2324',
        });

      expect(res.status).toBe(201);

      const job = await prisma.job.findUnique({ where: { id: res.body.id } });
      expect(job?.odsId).toBeNull();
      expect(job?.sendToOds).toBe(false);
    });

    // Partner A defaults to crossYearMatchingEnabled=false, so this also
    // guards the "cross-year matching disabled" rejection path.
    it('should reject no-ODS jobs when the roster file does not exist', async () => {
      await prisma.schoolYearConfig.create({
        data: {
          partnerId: tenantA.partnerId,
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
          .set('Cookie', [sessionA.cookie])
          .send({
            ...postJobDto,
            schoolYearId: '2324',
          });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain(
          'No roster file found and cross-year matching not enabled'
        );
      } finally {
        doesFileExistMock.mockResolvedValue(true);
      }
    });

    it('should propagate S3 errors from roster check instead of treating them as missing', async () => {
      await prisma.schoolYearConfig.create({
        data: {
          partnerId: tenantA.partnerId,
          schoolYearId: '2324',
          isEnabled: true,
          sendToOds: false,
        },
      });

      const doesFileExistMock = app.get(FileService).doesFileExist as jest.Mock;
      doesFileExistMock.mockRejectedValue(new Error('S3 operational failure'));

      try {
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Cookie', [sessionA.cookie])
          .send({
            ...postJobDto,
            schoolYearId: '2324',
          });

        expect(res.status).toBe(500);
      } finally {
        doesFileExistMock.mockResolvedValue(true);
      }
    });

    it('should create a no-ODS job without a roster file when cross-year matching is enabled', async () => {
      await prisma.schoolYearConfig.create({
        data: {
          partnerId: tenantA.partnerId,
          schoolYearId: '2324',
          isEnabled: true,
          sendToOds: false,
        },
      });
      await prisma.partner.update({
        where: { id: tenantA.partnerId },
        data: { crossYearMatchingEnabled: true },
      });

      const doesFileExistMock = app.get(FileService).doesFileExist as jest.Mock;
      doesFileExistMock.mockResolvedValue(false);

      try {
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Cookie', [sessionA.cookie])
          .send({
            ...postJobDto,
            schoolYearId: '2324',
          });

        expect(res.status).toBe(201);

        const job = await prisma.job.findUnique({ where: { id: res.body.id } });
        expect(job?.odsId).toBeNull();
        expect(job?.sendToOds).toBe(false);
      } finally {
        // No partner reset needed — seed data is refreshed before each test
        doesFileExistMock.mockResolvedValue(true);
      }
    });

    it('should reject requests when the school year is not enabled', async () => {
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send({
          ...postJobDto,
          schoolYearId: '2324',
        });
      expect(res.status).toBe(400);
    });

    it('should reject requests when an enabled send-to-ODS year has no ODS', async () => {
      await prisma.schoolYearConfig.create({
        data: {
          partnerId: tenantA.partnerId,
          schoolYearId: '2324',
          isEnabled: true,
          sendToOds: true,
        },
      });

      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send({
          ...postJobDto,
          schoolYearId: '2324',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('No ODS found');
    });

    it('should reject requests if a file name is an empty string', async () => {
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send({
          ...postJobDto,
          files: postJobDto.files.map((f) => ({ ...f, nameFromUser: '' })),
        });
      expect(res.status).toBe(400);
    });

    it('should reject requests if a file name is null', async () => {
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send({
          ...postJobDto,
          files: postJobDto.files.map((f) => ({ ...f, nameFromUser: null })),
        });
      expect(res.status).toBe(400);
    });
  });
});

describe('PUT /jobs/:id/start', () => {
  const endpoint = (id: number) => `/jobs/${id}/start`;
  const ecsTaskArn = 'arn:aws:ecs:us-east-1:123456789012:task/cluster/abc123';
  let executorStart: jest.SpyInstance;
  let cookieA: string;

  beforeEach(async () => {
    executorStart = jest
      .spyOn(ExecutorAwsService.prototype, 'start')
      .mockResolvedValue({ ecsTaskArn, taskSize: 'medium' });
    cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
  });

  afterEach(() => {
    executorStart.mockRestore();
  });

  it('starts a job with no run, launching one full run', async () => {
    const job = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
      idMatchingMode: 'fuzzy',
      runStatus: null,
    });

    const res = await request(app.getHttpServer()).put(endpoint(job.id)).set('Cookie', [cookieA]);

    expect(res.status).toBe(200);
    expect(await prisma.run.findMany({ where: { jobId: job.id } })).toEqual([
      expect.objectContaining({ kind: 'full', status: 'new', ecsTaskArn }),
    ]);
    expect(executorStart).toHaveBeenCalledTimes(1);
  });

  // A job is started once, in every mode.
  it.each<[IdMatchingMode, string, { kind: RunKind; status: RunStatus }[]]>([
    ['fuzzy', 'whose full run failed', [{ kind: 'full', status: 'error' }]],
    ['fuzzy', 'whose full run is running', [{ kind: 'full', status: 'running' }]],
    [
      'fuzzy',
      'with a send run',
      [
        { kind: 'full', status: 'success' },
        { kind: 'send', status: 'success' },
      ],
    ],
    ['id_based', 'whose full run failed', [{ kind: 'full', status: 'error' }]],
  ])(
    'refuses a job in %s mode %s, creating and launching no run',
    async (idMatchingMode, _, runs) => {
      const job = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
        idMatchingMode,
        runStatus: null,
      });
      await prisma.run.createMany({ data: runs.map((run) => ({ jobId: job.id, ...run })) });

      const res = await request(app.getHttpServer()).put(endpoint(job.id)).set('Cookie', [cookieA]);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(`Job already started: ${job.id}`);
      expect(await prisma.run.count({ where: { jobId: job.id } })).toBe(runs.length);
      expect(executorStart).not.toHaveBeenCalled();
    }
  );

  it('refuses a start that waited at the lock for another start, leaving one run', async () => {
    const job = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
      runStatus: null,
    });
    // Holds the job row as the other start does, until it commits its run.
    const holder = await holdJobRow(job.id);
    try {
      // then() sends the request now, rather than when it's awaited.
      const pending = request(app.getHttpServer())
        .put(endpoint(job.id))
        .set('Cookie', [cookieA])
        .then((res) => res);
      await waitUntilBlockedBy(holder.pid);
      // The request is now queued at startJob's lock (this throws if it
      // isn't), so it can only see the run below once the holder commits.
      await holder.client.query(
        "INSERT INTO public.run (job_id, kind, status) VALUES ($1, 'full', 'new')",
        [job.id]
      );
      await holder.client.query('COMMIT');
      const res = await pending;

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(`Job already started: ${job.id}`);
    } finally {
      await holder.release();
    }
    expect(await prisma.run.count({ where: { jobId: job.id } })).toBe(1);
    expect(executorStart).not.toHaveBeenCalled();
  });
});

describe('GET /jobs/:id/status-updates and /errors', () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = (await authHelper.login(idpA, userA, tenantA)).cookies;
  });

  /** The job's status updates' actions and its errors' codes. */
  const updatesAndErrorsOf = async (jobId: number, userCookie: string) => {
    const updates = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/status-updates`)
      .set('Cookie', [userCookie]);
    const errors = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/errors`)
      .set('Cookie', [userCookie]);
    return {
      updates: updates.body.map(({ action }: { action: string }) => action),
      errors: errors.body.map(({ error }: { error: { code: string } }) => error.code),
    };
  };

  it('returns the full run’s, not a later send run’s', async () => {
    // A send run follows only a successful full run.
    const job = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
      idMatchingMode: 'fuzzy',
      runStatus: 'success',
    });
    await prisma.runUpdate.create({
      data: { runId: job.runs[0].id, action: 'done', status: 'success' },
    });
    const sendRun = await prisma.run.create({
      data: { jobId: job.id, kind: 'send', status: 'error' },
    });
    await prisma.runUpdate.create({
      data: { runId: sendRun.id, action: 'lightbeam_send', status: 'failure' },
    });
    await prisma.runError.create({ data: { runId: sendRun.id, code: 'lightbeam_send' } });

    expect(await updatesAndErrorsOf(job.id, cookie)).toEqual({ updates: ['done'], errors: [] });
  });

  // A job is started once, so this guards a state that shouldn't occur.
  it('reads the latest full run, should a job ever have several', async () => {
    const job = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
      runStatus: 'success',
    });
    await prisma.run.update({
      where: { id: job.runs[0].id },
      data: {
        summary: {
          studentAssessments: { records_processed: 10, records_skipped: 0, records_failed: 2 },
        },
      },
    });
    await prisma.runUpdate.create({
      data: { runId: job.runs[0].id, action: 'earthmover_run', status: 'failure' },
    });
    await prisma.runError.create({ data: { runId: job.runs[0].id, code: 'earthmover_run' } });
    const latest = await prisma.run.create({
      data: {
        jobId: job.id,
        kind: 'full',
        status: 'success',
        summary: {
          studentAssessments: { records_processed: 10, records_skipped: 0, records_failed: 0 },
        },
      },
    });
    await prisma.runUpdate.create({
      data: { runId: latest.id, action: 'done', status: 'success' },
    });

    const read = await request(app.getHttpServer()).get(`/jobs/${job.id}`).set('Cookie', [cookie]);
    const readJob = plainToInstance(GetJobDto, read.body);

    expect({
      fullRunId: readJob.fullRun?.id,
      status: readJob.status,
      resourceSummaries: readJob.resourceSummaries,
    }).toEqual({
      fullRunId: latest.id,
      status: 'success',
      resourceSummaries: { studentAssessments: { success: 10, skipped: 0, failed: 0 } },
    });
    expect(await updatesAndErrorsOf(job.id, cookie)).toEqual({ updates: ['done'], errors: [] });
  });
});

describe('PUT /jobs/:id/resolve', () => {
  const endpoint = (id: number) => `/jobs/${id}/resolve`;
  let jobA: SeededJob;
  let jobB: SeededJob;

  beforeEach(async () => {
    [jobA, jobB] = await Promise.all([
      seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      }),
      seedJob({
        odsConfig: odsConfigB2526,
        bundle: bundleA,
        tenant: tenantB,
      }),
    ]);
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).put(endpoint(jobA.id));
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    let cookieB: string;
    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
      cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
    });

    it('should reject requests for jobs that are not associated with the tenant', async () => {
      const resA = await request(app.getHttpServer())
        .put(endpoint(jobA.id))
        .set('Cookie', [cookieB]);
      const resB = await request(app.getHttpServer())
        .put(endpoint(jobB.id))
        .set('Cookie', [cookieA]);
      expect(resA.status).toBe(403);
      expect(resB.status).toBe(403);
    });

    it('should allow a SupportUser logged into the global tenant to resolve a job in a descendant tenant', async () => {
      const supportUserGlobalCookie = (
        await authHelper.login(idpA, userA, tenantDGlobal, [
          'runway.test.user',
          'runway.test.supportuser',
        ])
      ).cookies;

      // 'success' + unmatched students yields a 'complete with errors' status, which is changeable
      await prisma.run.updateMany({
        where: { jobId: jobB.id },
        data: {
          status: 'success',
          unmatchedStudentsInfo: { name: 'unmatched-students', type: 'test', count: 1 },
        },
      });

      // jobB is a descendant of tenantDGlobal (same partner) and this route has
      // @AllowMetatenant, so this session/privilege combo should be sufficient
      // to resolve it, same as it is for GET /jobs/:id.
      const resB = await request(app.getHttpServer())
        .put(endpoint(jobB.id))
        .set('Cookie', [supportUserGlobalCookie])
        .send({ isResolved: true });
      expect(resB.status).toBe(200);

      const modifiedJob = await prisma.job.findUnique({ where: { id: jobB.id } });
      expect(modifiedJob?.isResolved).toBe(true);
    });

    it('should reject requests for jobs whose status is not changeable', async () => {
      // jobA's seeded run defaults to status 'new', which is not changeable
      const resA = await request(app.getHttpServer())
        .put(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ isResolved: true });
      expect(resA.status).toBe(400);
    });

    it('should mark jobs with a changeable status as resolved', async () => {
      // 'success' + unmatched students yields a 'complete with errors' status, which is changeable
      await prisma.run.updateMany({
        where: { jobId: jobA.id },
        data: {
          status: 'success',
          unmatchedStudentsInfo: { name: 'unmatched-students', type: 'test', count: 1 },
        },
      });

      const resA = await request(app.getHttpServer())
        .put(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ isResolved: true });
      expect(resA.status).toBe(200);

      const modifiedJob = await prisma.job.findUnique({ where: { id: jobA.id } });
      if (!modifiedJob) {
        throw new Error(`Job ${jobA.id} not found`);
      }
      expect(modifiedJob.isResolved).toBe(true);
    });

    it('should allow resolved jobs to revert to their original status', async () => {
      // 'success' + unmatched students yields a 'complete with errors' status, which is changeable
      await prisma.run.updateMany({
        where: { jobId: jobA.id },
        data: {
          status: 'success',
          unmatchedStudentsInfo: { name: 'unmatched-students', type: 'test', count: 1 },
        },
      });

      const statusBefore = toGetJobDto({
        ...(await prisma.job.findUniqueOrThrow({
          where: { id: jobA.id },
          include: { runs: true, files: true },
        })),
        studentMatchCounts: noStudentsToMatch,
      }).status;
      if (!statusBefore) {
        // sanity check
        throw new Error(`Job ${jobA.id} has no status`);
      }

      // first mark resolved
      const resAResolved = await request(app.getHttpServer())
        .put(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ isResolved: true });
      expect(resAResolved.status).toBe(200);

      // now revert
      const resAReverted = await request(app.getHttpServer())
        .put(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ isResolved: false });
      expect(resAReverted.status).toBe(200);

      const revertedJob = await prisma.job.findUniqueOrThrow({
        where: { id: jobA.id },
        include: { runs: { include: { runOutputFile: true } }, files: true },
      });

      const statusAfter = toGetJobDto({
        ...revertedJob,
        studentMatchCounts: noStudentsToMatch,
      }).status;
      expect(statusAfter).toBe(statusBefore);
    });
  });
});

describe('GET /jobs/:id/notes', () => {
  const endpoint = (id: number) => `/jobs/${id}/notes`;
  let jobA: SeededJob;
  let noteA1: JobNote;
  let noteA2: JobNote;
  beforeEach(async () => {
    jobA = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
    });

    const cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
    await request(app.getHttpServer())
      .post(endpoint(jobA.id))
      .set('Cookie', [cookieA])
      .send({ noteText: 'test note for job ' + jobA.id });
    await request(app.getHttpServer())
      .post(endpoint(jobA.id))
      .set('Cookie', [cookieA])
      .send({ noteText: 'another test note for job ' + jobA.id });

    [noteA1, noteA2] = await prisma.jobNote.findMany({ where: { jobId: jobA.id } });
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint(jobA.id));
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
    });
    it('should reject requests for jobs that are not associated with the tenant', async () => {
      const cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
      const resA = await request(app.getHttpServer())
        .get(endpoint(jobA.id))
        .set('Cookie', [cookieB]);
      expect(resA.status).toBe(403);
    });

    it('should return the notes for the job', async () => {
      const resA = await request(app.getHttpServer())
        .get(endpoint(jobA.id))
        .set('Cookie', [cookieA]);
      expect(resA.status).toBe(200);
      expect(resA.body.length).toBe(2);
      expect(resA.body[0].id).toBe(noteA1.id);
      expect(resA.body[0].noteText).toBe(noteA1.noteText);
      expect(resA.body[0].createdById).toBe(userA.id);
      expect(resA.body[0].createdOn).toBeDefined();
      expect(resA.body[1].id).toBe(noteA2.id);
      expect(resA.body[1].noteText).toBe(noteA2.noteText);
      expect(resA.body[1].createdById).toBe(userA.id);
      expect(resA.body[1].createdOn).toBeDefined();
    });

    it('should allow a SupportUser logged into the global tenant to view notes for a job in a descendant tenant', async () => {
      const jobB = await seedJob({
        odsConfig: odsConfigB2526,
        bundle: bundleA,
        tenant: tenantB,
      });
      await prisma.jobNote.create({
        data: {
          jobId: jobB.id,
          noteText: 'test note for job ' + jobB.id,
          createdById: userB.id,
          createdOn: new Date(),
        },
      });

      const supportUserGlobalCookie = (
        await authHelper.login(idpA, userA, tenantDGlobal, [
          'runway.test.user',
          'runway.test.supportuser',
        ])
      ).cookies;

      // jobB is a descendant of tenantDGlobal (same partner) and this route has
      // @AllowMetatenant, so this session/privilege combo should be sufficient
      // to resolve it, same as it is for PUT /jobs/:id/resolve.
      const resB = await request(app.getHttpServer())
        .get(endpoint(jobB.id))
        .set('Cookie', [supportUserGlobalCookie]);
      expect(resB.status).toBe(200);
      expect(resB.body.length).toBe(1);
    });
  });
});

describe('POST /jobs/:id/notes', () => {
  const endpoint = (id: number) => `/jobs/${id}/notes`;
  let jobA: SeededJob;

  beforeEach(async () => {
    jobA = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
    });
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).post(endpoint(jobA.id));
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    let cookieB: string;
    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
      cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
    });
    it('should create a new note for the job', async () => {
      const noteText = 'test note for job ' + jobA.id;
      const resA = await request(app.getHttpServer())
        .post(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ noteText });

      expect(resA.status).toBe(201);
      const notes = await prisma.jobNote.findMany({ where: { jobId: jobA.id } });
      expect(notes.length).toBe(1);
      expect(notes[0].noteText).toBe(noteText);
      expect(notes[0].createdById).toBe(userA.id);
      expect(notes[0].createdOn).toBeDefined();
    });

    it('should allow a job to have multiple notes', async () => {
      const noteText1 = 'test note 1 for job ' + jobA.id;
      const noteText2 = 'test note 2 for job ' + jobA.id;

      const res1 = await request(app.getHttpServer())
        .post(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ noteText: noteText1 });
      expect(res1.status).toBe(201);

      const res2 = await request(app.getHttpServer())
        .post(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ noteText: noteText2 });
      expect(res2.status).toBe(201);

      const notes = await prisma.jobNote.findMany({ where: { jobId: jobA.id } });
      expect(notes.length).toBe(2);
      expect(notes[0].noteText).toBe(noteText1);
      expect(notes[1].noteText).toBe(noteText2);
    });

    it('should reject requests with a note text that exceeds the character limit', async () => {
      const noteText = 'a'.repeat(NOTE_CHAR_LIMIT + 1);
      const res = await request(app.getHttpServer())
        .post(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ noteText });
      expect(res.status).toBe(400);
    });

    it('should reject requests with a note text that is empty', async () => {
      const noteText = '';
      const res = await request(app.getHttpServer())
        .post(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ noteText });
      expect(res.status).toBe(400);
    });

    it('should reject requests if the user does not have access to the job', async () => {
      const resA = await request(app.getHttpServer())
        .post(endpoint(jobA.id))
        .set('Cookie', [cookieB])
        .send({ noteText: 'test note for job ' + jobA.id });

      expect(resA.status).toBe(403);
    });

    it('should allow a SupportUser logged into the global tenant to create a note for a job in a descendant tenant', async () => {
      const jobB = await seedJob({
        odsConfig: odsConfigB2526,
        bundle: bundleA,
        tenant: tenantB,
      });
      const supportUserGlobalCookie = (
        await authHelper.login(idpA, userA, tenantDGlobal, [
          'runway.test.user',
          'runway.test.supportuser',
        ])
      ).cookies;

      // jobB is a descendant of tenantDGlobal (same partner) and this route has
      // @AllowMetatenant, so this session/privilege combo should be sufficient
      // to resolve it, same as it is for PUT /jobs/:id/resolve.
      const noteText = 'test note for job ' + jobB.id;
      const resB = await request(app.getHttpServer())
        .post(endpoint(jobB.id))
        .set('Cookie', [supportUserGlobalCookie])
        .send({ noteText });

      expect(resB.status).toBe(201);
      const notes = await prisma.jobNote.findMany({ where: { jobId: jobB.id } });
      expect(notes.length).toBe(1);
      expect(notes[0].noteText).toBe(noteText);
    });
  });
});

describe('PUT /jobs/:id/notes/:noteId', () => {
  const endpoint = (id: number, noteId: number) => `/jobs/${id}/notes/${noteId}`;
  let jobA: SeededJob;
  let noteA: JobNote;
  beforeEach(async () => {
    jobA = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
    });
    noteA = await prisma.jobNote.create({
      data: {
        jobId: jobA.id,
        noteText: 'test note for job ' + jobA.id,
        createdById: userA.id,
        createdOn: new Date(),
      },
    });
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer())
      .put(endpoint(jobA.id, noteA.id))
      .send({ noteText: 'updated note for job ' + jobA.id });
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
    });
    it('should reject requests if the job is not associated with the tenant', async () => {
      const cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
      const resA = await request(app.getHttpServer())
        .put(endpoint(jobA.id, noteA.id))
        .set('Cookie', [cookieB])
        .send({ noteText: 'updated note for job ' + jobA.id });
      expect(resA.status).toBe(403);
    });

    it('should reject requests if the note is not associated with the job', async () => {
      const jobA2 = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });
      const noteA2 = await prisma.jobNote.create({
        data: {
          jobId: jobA2.id,
          noteText: 'test note for job ' + jobA2.id,
          createdById: userA.id,
          createdOn: new Date(),
        },
      });

      const resA = await request(app.getHttpServer())
        .put(endpoint(jobA.id, noteA2.id)) // mismatch
        .set('Cookie', [cookieA])
        .send({ noteText: 'updated note for job ' + jobA.id });
      expect(resA.status).toBe(404);
    });

    it('should update the note text', async () => {
      const updatedNoteText = 'this is the updated note text for job ' + jobA.id;
      const resA = await request(app.getHttpServer())
        .put(endpoint(jobA.id, noteA.id))
        .set('Cookie', [cookieA])
        .send({ noteText: updatedNoteText });
      expect(resA.status).toBe(200);
      const note = await prisma.jobNote.findUniqueOrThrow({ where: { id: noteA.id } });
      expect(note.noteText).toBe(updatedNoteText);
    });

    it('should track the modified by user', async () => {
      const cookieA2 = (await authHelper.login(idpA, userB, tenantA)).cookies; // userB authed in tenantA can access the job
      const updatedNoteText = 'updated note for job ' + jobA.id + ' by userB';
      const resA = await request(app.getHttpServer())
        .put(endpoint(jobA.id, noteA.id))
        .set('Cookie', [cookieA2])
        .send({ noteText: updatedNoteText });
      expect(resA.status).toBe(200);
      const note = await prisma.jobNote.findUniqueOrThrow({ where: { id: noteA.id } });
      expect(note.modifiedById).toBe(userB.id);
      expect(note.noteText).toBe(updatedNoteText);
    });

    it('should reject requests if the note text exceeds the character limit', async () => {
      const noteText = 'a'.repeat(NOTE_CHAR_LIMIT + 1);
      const res = await request(app.getHttpServer())
        .put(endpoint(jobA.id, noteA.id))
        .set('Cookie', [cookieA])
        .send({ noteText });
      expect(res.status).toBe(400);
    });

    it('should reject requests if the note text is empty', async () => {
      const res = await request(app.getHttpServer())
        .put(endpoint(jobA.id, noteA.id))
        .set('Cookie', [cookieA])
        .send({ noteText: '' });
      expect(res.status).toBe(400);
    });

    it('should allow a SupportUser logged into the global tenant to update a note for a job in a descendant tenant', async () => {
      const jobB = await seedJob({
        odsConfig: odsConfigB2526,
        bundle: bundleA,
        tenant: tenantB,
      });
      const noteB = await prisma.jobNote.create({
        data: {
          jobId: jobB.id,
          noteText: 'test note for job ' + jobB.id,
          createdById: userB.id,
          createdOn: new Date(),
        },
      });
      const supportUserGlobalCookie = (
        await authHelper.login(idpA, userA, tenantDGlobal, [
          'runway.test.user',
          'runway.test.supportuser',
        ])
      ).cookies;

      // jobB is a descendant of tenantDGlobal (same partner) and this route has
      // @AllowMetatenant, so this session/privilege combo should be sufficient
      // to resolve it, same as it is for PUT /jobs/:id/resolve.
      const updatedNoteText = 'updated note for job ' + jobB.id;
      const resB = await request(app.getHttpServer())
        .put(endpoint(jobB.id, noteB.id))
        .set('Cookie', [supportUserGlobalCookie])
        .send({ noteText: updatedNoteText });

      expect(resB.status).toBe(200);
      const note = await prisma.jobNote.findUniqueOrThrow({ where: { id: noteB.id } });
      expect(note.noteText).toBe(updatedNoteText);
    });
  });
});

describe('DELETE /jobs/:id/notes/:noteId', () => {
  const endpoint = (id: number, noteId: number) => `/jobs/${id}/notes/${noteId}`;
  let jobA: SeededJob;
  let noteA1: JobNote;
  let noteA2: JobNote;
  beforeEach(async () => {
    jobA = await seedJob({
      odsConfig: odsConfigA2425,
      bundle: bundleA,
      tenant: tenantA,
    });
    noteA1 = await prisma.jobNote.create({
      data: {
        jobId: jobA.id,
        noteText: 'test note for job ' + jobA.id,
        createdById: userA.id,
        createdOn: new Date(),
      },
    });
    noteA2 = await prisma.jobNote.create({
      data: {
        jobId: jobA.id,
        noteText: 'test note for job ' + jobA.id,
        createdById: userA.id,
        createdOn: new Date(),
      },
    });
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).delete(endpoint(jobA.id, noteA1.id));
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
    });
    it('should delete the note', async () => {
      const resA = await request(app.getHttpServer())
        .delete(endpoint(jobA.id, noteA1.id))
        .set('Cookie', [cookieA]);
      expect(resA.status).toBe(200);
      const notes = await prisma.jobNote.findMany({ where: { jobId: jobA.id } });
      expect(notes.length).toBe(1);
      expect(notes[0].id).toBe(noteA2.id);
    });

    it('should reject requests if the user does not have access to the job', async () => {
      const cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
      const resA = await request(app.getHttpServer())
        .delete(endpoint(jobA.id, noteA1.id))
        .set('Cookie', [cookieB])
        .send({ noteText: 'test note for job ' + jobA.id });
      expect(resA.status).toBe(403);
      const notes = await prisma.jobNote.findMany({ where: { jobId: jobA.id } });
      expect(notes.length).toBe(2);
    });

    it('should reject requests if the note is not associated with the job', async () => {
      const jobA2 = await seedJob({
        odsConfig: odsConfigA2425,
        bundle: bundleA,
        tenant: tenantA,
      });
      const noteA2 = await prisma.jobNote.create({
        data: {
          jobId: jobA2.id,
          noteText: 'test note for job ' + jobA2.id,
          createdById: userA.id,
          createdOn: new Date(),
        },
      });

      const resA = await request(app.getHttpServer())
        .delete(endpoint(jobA.id, noteA2.id)) // mismatch
        .set('Cookie', [cookieA])
        .send({ noteText: 'updated note for job ' + jobA.id });
      expect(resA.status).toBe(404);

      const jobANotes = await prisma.jobNote.findMany({ where: { jobId: jobA.id } });
      expect(jobANotes.length).toBe(2);
      const jobA2Notes = await prisma.jobNote.findMany({ where: { jobId: jobA2.id } });
      expect(jobA2Notes.length).toBe(1);
      expect(jobA2Notes[0].id).toBe(noteA2.id);
    });

    it('should allow a SupportUser logged into the global tenant to delete a note for a job in a descendant tenant', async () => {
      const jobB = await seedJob({
        odsConfig: odsConfigB2526,
        bundle: bundleA,
        tenant: tenantB,
      });
      const noteB = await prisma.jobNote.create({
        data: {
          jobId: jobB.id,
          noteText: 'test note for job ' + jobB.id,
          createdById: userB.id,
          createdOn: new Date(),
        },
      });
      const supportUserGlobalCookie = (
        await authHelper.login(idpA, userA, tenantDGlobal, [
          'runway.test.user',
          'runway.test.supportuser',
        ])
      ).cookies;

      // jobB is a descendant of tenantDGlobal (same partner) and this route has
      // @AllowMetatenant, so this session/privilege combo should be sufficient
      // to resolve it, same as it is for PUT /jobs/:id/resolve.
      const resB = await request(app.getHttpServer())
        .delete(endpoint(jobB.id, noteB.id))
        .set('Cookie', [supportUserGlobalCookie]);

      expect(resB.status).toBe(200);
      const notes = await prisma.jobNote.findMany({ where: { jobId: jobB.id } });
      expect(notes.length).toBe(0);
    });
  });
});
