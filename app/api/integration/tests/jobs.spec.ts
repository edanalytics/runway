import request from 'supertest';
import { sessionCookie } from '../helpers/session/session-cookie';
import sessionStore from '../helpers/session/session-store';
import { tenantA, tenantB, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB, userX } from '../fixtures/user-fixtures';
import { sessionData } from '../helpers/session/session-factory';
import {
  odsConfigX2425,
  odsConnA2425,
  odsConnB2526,
  odsConnX2425,
} from '../fixtures/context-fixtures/ods-fixture';
import { allBundles, bundleA, bundleX } from '../fixtures/em-bundle-fixtures';
import { makePostJobDto } from '../factories/job-input-factory';
import { makeJobTemplate } from '../factories/job-template-factory';
import { EarthbeamBundlesService } from 'api/src/earthbeam/earthbeam-bundles.service';
import { DtoableJob, GetJobDto, PostJobDto, toGetJobDto } from 'models/src/dtos/job.dto';
import { seedJob } from '../factories/job-factory';
import { plainToInstance } from 'class-transformer';
import { Job, JobNote } from '@prisma/client';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { NOTE_CHAR_LIMIT } from 'models/src/constants';

describe('GET /jobs', () => {
  const endpoint = '/jobs';
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpoint);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    const sessionA = sessionCookie('jobs-spec');
    const sessionX = sessionCookie('jobs-spec-x');

    let aJobs: DtoableJob[] = [];
    beforeAll(async () => {
      // A starts with jobs, X starts with none
      await sessionStore.set(sessionA.sid, sessionData(userA, tenantA));
      await sessionStore.set(sessionX.sid, sessionData(userX, tenantX));
      aJobs = await Promise.all([
        seedJob({
          odsConnection: odsConnA2425,
          bundle: bundleA,
          tenant: tenantA,
        }),
        seedJob({
          odsConnection: odsConnA2425,
          bundle: bundleA,
          tenant: tenantA,
          summary: true,
          unmatchedStudentsInfo: true,
          outputFiles: true,
        }),
      ]);
    });

    afterAll(async () => {
      await sessionStore.destroy(sessionA.sid);
      await sessionStore.destroy(sessionX.sid);
      await prisma.job.deleteMany({
        where: {
          id: {
            in: aJobs.map((j) => j.id),
          },
        },
      });
    });

    it('should return an empty array if there are no jobs', async () => {
      // X has no jobs
      const resX = await request(app.getHttpServer())
        .get(endpoint)
        .set('Cookie', [sessionX.cookie]);
      expect(resX.status).toBe(200);
      expect(resX.body).toEqual([]);
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
          expect(jDto.odsId).toBe(original?.odsId);
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
            expect(r.runOutputFile?.map((f) => f.name)).toEqual(
              expect.arrayContaining(originalRun.runOutputFile?.map((f) => f.name) ?? [])
            );
            expect(r.unmatchedStudentsInfo ?? {}).toEqual(
              expect.objectContaining(originalRun.unmatchedStudentsInfo ?? {})
            );
          });
        });
    });

    it('should return a list of jobs for each tenant', async () => {
      const xJobs: DtoableJob[] = [
        await seedJob({
          odsConnection: odsConnX2425,
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

      await prisma.job.deleteMany({
        where: {
          id: {
            in: xJobs.map((j) => j.id),
          },
        },
      });
    });
  });
});

describe('GET /jobs/:id', () => {
  let endpointA: string;
  let endpointB: string;
  let jobA: Job;
  let jobB: Job;

  beforeAll(async () => {
    [jobA, jobB] = await Promise.all([
      seedJob({
        odsConnection: odsConnA2425,
        bundle: bundleA,
        tenant: tenantA,
      }),
      seedJob({
        odsConnection: odsConnB2526,
        bundle: bundleA, // same bundle for both tenants is fine
        tenant: tenantB,
      }),
    ]);
    endpointA = `/jobs/${jobA.id}`;
    endpointB = `/jobs/${jobB.id}`;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({
      where: { id: { in: [jobA.id, jobB.id] } },
    });
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

    afterEach(async () => {
      await authHelper.logout(cookieA);
      await authHelper.logout(cookieB);
    });

    it('should return the job if the user is logged into the associated tenant', async () => {
      const resA = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieA]);
      expect(resA.status).toBe(200);
      expect(resA.body.id).toEqual(jobA.id);
    });

    it('should reject requests for jobs that are not associated with the tenant', async () => {
      // user in Tenant B requests Job in Tenant A, user in Tenant A requests Job in Tenant B
      const resA = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieB]);
      const resB = await request(app.getHttpServer()).get(endpointB).set('Cookie', [cookieA]);
      expect(resA.status).toBe(403);
      expect(resB.status).toBe(403);
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
    const postJobDto = makePostJobDto(jobTemplateA, odsConnA2425);
    let getBundlesMock: jest.SpyInstance;

    beforeAll(async () => {
      await sessionStore.set(sessionA.sid, sessionData(userA, tenantA));
      getBundlesMock = jest
        .spyOn(EarthbeamBundlesService.prototype, 'getBundles')
        .mockResolvedValue(allBundles);
    });

    afterAll(async () => {
      await sessionStore.destroy(sessionA.sid);
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
    });

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

    it('should reject requests with an ODS that is not owned by the tenant', async () => {
      const jobInputWithNonOwnedOds: PostJobDto = {
        ...postJobDto,
        odsId: odsConfigX2425.id,
      };
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [sessionA.cookie])
        .send(jobInputWithNonOwnedOds);
      expect(res.status).toBe(400);
    });
  });
});

describe('PUT /jobs/:id/resolve', () => {
  const endpoint = (id: number) => `/jobs/${id}/resolve`;
  let jobA: DtoableJob;
  let jobB: DtoableJob;

  beforeEach(async () => {
    [jobA, jobB] = await Promise.all([
      seedJob({
        odsConnection: odsConnA2425,
        bundle: bundleA,
        tenant: tenantA,
      }),
      seedJob({
        odsConnection: odsConnB2526,
        bundle: bundleA,
        tenant: tenantB,
      }),
    ]);
  });

  afterEach(async () => {
    await prisma.job.deleteMany({
      where: { id: { in: [jobA.id, jobB.id] } },
    });
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

    it('should reject requests for jobs whose status is not changeable', async () => {
      const mock = jest
        .spyOn(GetJobDto.prototype, 'isStatusChangeable', 'get')
        .mockReturnValue(false);

      const resA = await request(app.getHttpServer())
        .put(endpoint(jobA.id))
        .set('Cookie', [cookieA]);
      expect(resA.status).toBe(400);

      mock.mockRestore();
    });

    it('should mark jobs with a changeable status as resolved', async () => {
      const mock = jest
        .spyOn(GetJobDto.prototype, 'isStatusChangeable', 'get')
        .mockReturnValue(true);

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
      mock.mockRestore();
    });

    it('should allow resolved jobs to revert to their original status', async () => {
      const statusBefore = toGetJobDto(jobA).status;
      if (!statusBefore) {
        // sanity check
        throw new Error(`Job ${jobA.id} has no status`);
      }

      // first mark resolved
      const mock = jest
        .spyOn(GetJobDto.prototype, 'isStatusChangeable', 'get')
        .mockReturnValue(true);
      const resAResolved = await request(app.getHttpServer())
        .put(endpoint(jobA.id))
        .set('Cookie', [cookieA])
        .send({ isResolved: true });
      expect(resAResolved.status).toBe(200);
      mock.mockRestore(); // we want to test without a mock for resetting the status

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

      const statusAfter = toGetJobDto(revertedJob).status;
      expect(statusAfter).toBe(statusBefore);
    });
  });
});

describe('GET /jobs/:id/notes', () => {
  const endpoint = (id: number) => `/jobs/${id}/notes`;
  let jobA: DtoableJob;
  let noteA1: JobNote;
  let noteA2: JobNote;
  beforeEach(async () => {
    jobA = await seedJob({
      odsConnection: odsConnA2425,
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

  afterEach(async () => {
    await prisma.jobNote.deleteMany({
      where: { jobId: jobA.id },
    });
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
    afterEach(async () => {
      await authHelper.logout(cookieA);
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
  });
});

describe('POST /jobs/:id/notes', () => {
  const endpoint = (id: number) => `/jobs/${id}/notes`;
  let jobA: DtoableJob;

  beforeEach(async () => {
    jobA = await seedJob({
      odsConnection: odsConnA2425,
      bundle: bundleA,
      tenant: tenantA,
    });
  });

  afterEach(async () => {
    await prisma.jobNote.deleteMany({
      where: { jobId: jobA.id },
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
    afterEach(async () => {
      await authHelper.logout(cookieA);
      await authHelper.logout(cookieB);
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
  });
});

describe('PUT /jobs/:id/notes/:noteId', () => {
  const endpoint = (id: number, noteId: number) => `/jobs/${id}/notes/${noteId}`;
  let jobA: DtoableJob;
  let noteA: JobNote;
  beforeEach(async () => {
    jobA = await seedJob({
      odsConnection: odsConnA2425,
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

  afterEach(async () => {
    // cascade takes care of the note
    await prisma.job.deleteMany({
      where: { id: jobA.id },
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
    afterEach(async () => {
      await authHelper.logout(cookieA);
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
        odsConnection: odsConnA2425,
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

      await prisma.job.deleteMany({
        where: { id: jobA2.id },
      });
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
  });
});

describe('DELETE /jobs/:id/notes/:noteId', () => {
  const endpoint = (id: number, noteId: number) => `/jobs/${id}/notes/${noteId}`;
  let jobA: DtoableJob;
  let noteA1: JobNote;
  let noteA2: JobNote;
  beforeEach(async () => {
    jobA = await seedJob({
      odsConnection: odsConnA2425,
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

  afterEach(async () => {
    await prisma.job.deleteMany({
      where: { id: jobA.id },
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
    afterEach(async () => {
      await authHelper.logout(cookieA);
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

      await authHelper.logout(cookieB);
    });

    it('should reject requests if the note is not associated with the job', async () => {
      const jobA2 = await seedJob({
        odsConnection: odsConnA2425,
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

      await prisma.job.deleteMany({
        where: { id: jobA2.id },
      });
    });
  });
});
