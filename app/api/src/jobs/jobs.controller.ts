import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { PRISMA_APP_USER } from '../database';
import { PrismaClient } from '@prisma/client';
import { JobsService } from './jobs.service';
import { Tenant } from '../auth/helpers/tenant.decorator';
import { SkipTenantOwnership } from '../auth/authorization/skip-tenant-ownership.decorator';
import type { Tenant as TTenant, User } from '@prisma/client';
import {
  GetJobDto,
  GetSessionDataDto,
  NOTE_CHAR_LIMIT,
  PostJobDto,
  PostJobResponseDto,
  PutJobResolveDto,
  toGetJobDto,
  toGetOutputFileDto,
  toGetRunUpdateDto,
  toGetStudentMatchResultsDto,
  toJobErrorWrapperDto,
} from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { TenantOwnershipGuard } from '../auth/authorization/tenant-ownership.guard';
import { TenantResourceKey } from '../auth/authorization/tenant-resource-key.decorator';
import { PostJobNoteDto, PutJobNoteDto, toGetJobNoteDto } from 'models/src/dtos/job-note.dto';
import { AllowMetatenant } from '../auth/authorization/allow-metatenant.decorator';
import { Authorize } from '../auth/helpers/authorize.decorator';

@Controller()
@ApiTags('Job')
@TenantResourceKey('job')
@UseGuards(TenantOwnershipGuard)
export class JobsController {
  private logger = new Logger(JobsController.name);
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private jobService: JobsService
  ) {}

  @Get()
  @SkipTenantOwnership()
  async findAll(@Tenant() tenant: TTenant) {
    const jobs = await this.prisma.job.findMany({
      where: { tenantCode: tenant.code, partnerId: tenant.partnerId, runs: { some: {} } },
      include: {
        schoolYear: true,
        runs: true,
        files: true,
        createdBy: true,
      },
    });
    // Counted separately: an included _count would aggregate all of
    // student_input_details on every load, since Postgres can't push the
    // list's filter into it. This reads only the listed jobs, by primary key.
    const counts = new Map(
      (
        await this.prisma.studentInputDetails.groupBy({
          by: ['jobId'],
          where: { jobId: { in: jobs.map((job) => job.id) } },
          _count: true,
        })
      ).map(({ jobId, _count }) => [jobId, _count])
    );

    return toGetJobDto(
      jobs.map((job) => ({ ...job, studentsToMatchCount: counts.get(job.id) ?? 0 }))
    );
  }

  @Get(':jobId')
  @AllowMetatenant('job.metatenant.read')
  async findOne(
    @Param('jobId', new ParseIntPipe())
    jobId: number
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        files: true,
        runs: {
          include: {
            runError: true,
            runUpdate: true,
          },
        },
        _count: { select: { studentInputDetails: true } },
      },
    });

    if (!job) {
      return new NotFoundException(`Job not found: ${jobId}`);
    }

    return toGetJobDto({ ...job, studentsToMatchCount: job._count.studentInputDetails });
  }

  @Get(':jobId/files/:templateKey')
  @AllowMetatenant('job.metatenant.read')
  async downloadUrlForInputFile(
    @Param('jobId', new ParseIntPipe()) jobId: number,
    @Param('templateKey') templateKey: string
  ) {
    const url = await this.jobService.getDownloadUrlForInputFile(jobId, templateKey);
    if (!url) {
      return new NotFoundException(
        `File not found for job ${jobId} and template key ${templateKey}`
      );
    }
    return url;
  }
  @Get(':jobId/output-files')
  @AllowMetatenant('job.metatenant.output-files.read')
  @Authorize('job.output-files.read')
  async getOutputFiles(@Param('jobId', new ParseIntPipe()) jobId: number) {
    const files = await this.prisma.runOutputFile.findMany({
      where: { run: { jobId } },
      orderBy: { runId: 'desc' },
    });
    return toGetOutputFileDto(files);
  }

  @Get(':jobId/output-files/input_no_student_id_match.csv')
  @AllowMetatenant('job.metatenant.read')
  async downloadUrlForUnmatchedStudentsOutputFile(
    @Param('jobId', new ParseIntPipe()) jobId: number
  ) {
    const url = await this.jobService.getDownloadUrlForOutputFile(
      jobId,
      'input_no_student_id_match.csv'
    );
    if (!url) {
      return new NotFoundException(
        `File not found for job ${jobId} and file input_no_student_id_match.csv`
      );
    }
    return url;
  }

  @Get(':jobId/output-files/:fileName')
  @AllowMetatenant('job.metatenant.output-files.read')
  @Authorize('job.output-files.read')
  async downloadUrlForOutputFile(
    @Param('jobId', new ParseIntPipe()) jobId: number,
    @Param('fileName') fileName: string
  ) {
    const decodedFilename = decodeURIComponent(fileName);
    const url = await this.jobService.getDownloadUrlForOutputFile(jobId, decodedFilename);
    if (!url) {
      return new NotFoundException(`File not found for job ${jobId} and file ${decodedFilename}`);
    }
    return url;
  }

  @Get(':jobId/status-updates')
  @AllowMetatenant('job.metatenant.read')
  async getStatusUpdates(
    @Param('jobId', new ParseIntPipe())
    jobId: number
  ) {
    const updates = await this.jobService.getStatusUpdates(jobId);
    return updates ? toGetRunUpdateDto(updates) : null;
  }

  @Get(':jobId/errors')
  @AllowMetatenant('job.metatenant.read')
  async getErrors(
    @Param('jobId', new ParseIntPipe())
    jobId: number
  ) {
    const errors = await this.jobService.getErrors(jobId);
    return errors ? toJobErrorWrapperDto(errors) : null;
  }

  /**
   * To fully prepare a job, we need to:
   * 1. Gather user input to choose a type of job, input files, and some job params
   * 2. Save this to the DB and get a job ID
   * 3. Get presigned URLs where the client can save (path includes Job ID)
   * 4. Upload files in S3 (done by client, directly to S3)
   * 5. Send the job to ECS (:jobId/start handler)
   */
  @Post()
  @SkipTenantOwnership()
  async initialize(@Body() createJobDto: PostJobDto, @Tenant() tenant: TTenant) {
    // ─── Verify bundle is enabled for partner ───────────────────────────────
    await this.prisma.partnerEarthmoverBundle
      .findUniqueOrThrow({
        where: {
          partnerId_earthmoverBundleKey: {
            partnerId: tenant.partnerId,
            earthmoverBundleKey: createJobDto.template.path,
          },
        },
      })
      .catch(() => {
        throw new BadRequestException(
          `Bundle not found or not enabled for partner: ${createJobDto.template.path}`
        );
      });

    const destination = await this.jobService.resolveJobDestination({
      schoolYearId: createJobDto.schoolYearId,
      tenant,
    });
    if (destination.status === 'error') {
      const year = createJobDto.schoolYearId;
      const messages: Record<typeof destination.code, string> = {
        school_year_config_missing: `School year is not enabled: ${year}`,
        school_year_disabled: `School year is not enabled: ${year}`,
        ods_not_found: `No ODS found for school year: ${year}`,
        roster_unavailable: `No roster file found and cross-year matching not enabled for school year: ${year}`,
      };
      throw new BadRequestException(messages[destination.code]);
    }

    // Flatten params to Record<string, string>
    // Service will add fresh metadata from the bundle. We shouldn't trust the metadata coming in here anyway.
    const flatParams = Object.fromEntries(
      createJobDto.inputParams
        .map((p) => [p.templateKey, p.value])
        .filter((p): p is [string, string] => p[1] !== null && p[1] !== undefined) // filter out params user didn't give a value
    );

    // ─── Create job ───────────────────────────────────────────────────────────
    const result = await this.jobService.createJob(
      {
        bundlePath: createJobDto.template.path,
        odsId: destination.data.odsId,
        sendToOds: destination.data.sendToOds,
        schoolYearId: destination.data.schoolYearId,
        files: createJobDto.files,
        params: flatParams,
      },
      tenant,
      this.prisma
    );

    // ─── Handle result ────────────────────────────────────────────────────────
    if (result.status === 'error') {
      throw new BadRequestException(result.message);
    }

    const uploadUrls = await this.jobService.getUploadUrls(result.job.files);
    return plainToInstance(PostJobResponseDto, {
      id: result.job.id,
      uploadLocations: uploadUrls,
    });
  }

  @Put(':jobId/start')
  async start(@Param('jobId', ParseIntPipe) jobId: GetJobDto['id']) {
    // assumes route only called if file upload succeeded, could be made more robust
    const updatedJob = await this.jobService.updateFileStatusForJob(
      jobId,
      'upload_complete',
      this.prisma
    );

    const res = await this.jobService.startJob(updatedJob, this.prisma);
    if (res.result === 'JOB_STARTED') {
      return;
    } else if (res.result === 'JOB_CONFIG_INCOMPLETE') {
      throw new BadRequestException(`Job config incomplete: ${jobId}`);
    } else if (res.result === 'JOB_IN_PROGRESS') {
      throw new BadRequestException(`Job already in progress: ${jobId}`);
    } else if (res.result === 'JOB_START_FAILED') {
      throw new InternalServerErrorException(`Failed to start job ${jobId}`);
    } else {
      this.logger.error(`Unknown return value from starting job ${jobId}. 
        Result: ${res.result}
        Job: ${JSON.stringify(updatedJob, null, 2)}`);
      throw new InternalServerErrorException(`Unknown error starting job ${jobId}`);
    }
  }

  @Put(':jobId/resolve')
  @AllowMetatenant('job.metatenant.update')
  async resolve(
    @Param('jobId', ParseIntPipe) jobId: GetJobDto['id'],
    @Body() resolveJobDto: PutJobResolveDto
  ) {
    const found = await this.prisma.job
      .findUniqueOrThrow({
        where: { id: jobId },
        include: {
          files: true,
          runs: true,
          _count: { select: { studentInputDetails: true } },
        },
      })
      .catch(() => {
        // not founds should be thrown before we get to the handler, but just in case
        throw new NotFoundException(`Job not found: ${jobId}`);
      });
    const job = toGetJobDto({ ...found, studentsToMatchCount: found._count.studentInputDetails });

    if (!job.isStatusChangeable) {
      throw new BadRequestException(`Job is not changeable: ${jobId}`);
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: { isResolved: resolveJobDto.isResolved },
    });

    return;
  }

  @Get(':jobId/student-match-results')
  @AllowMetatenant('job.metatenant.read')
  @Authorize('job.match-results.read')
  async getStudentMatchResults(@Param('jobId', ParseIntPipe) jobId: number, @Req() req: Request) {
    // Who may read depends on the job's mode (see AGENTS.md), so the check
    // can't be a route decorator.
    if (!req.job) {
      // Set by the job middleware; fail closed if it ever isn't.
      throw new InternalServerErrorException('No job on the request');
    }
    const isFuzzyBackground = req.job.idMatchingMode === 'id_based_fuzzy_background';
    const session = plainToInstance(GetSessionDataDto, req.user);
    if (isFuzzyBackground && !session.privileges.has('job.match-results.background.read')) {
      throw new ForbiddenException('Forbidden');
    }
    return toGetStudentMatchResultsDto(await this.jobService.getStudentMatchResults(jobId));
  }

  @Get(':jobId/notes')
  @AllowMetatenant('job.metatenant.read')
  async getNotes(@Param('jobId', ParseIntPipe) jobId: number) {
    const notes = await this.prisma.jobNote.findMany({
      where: { jobId },
      include: { createdBy: true, modifiedBy: true },
      orderBy: { createdOn: 'asc' },
    });
    return toGetJobNoteDto(notes);
  }

  @Post(':jobId/notes')
  @AllowMetatenant('job.metatenant.update')
  async createNote(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Body() createNoteDto: PostJobNoteDto
  ) {
    await this.prisma.jobNote.create({
      data: {
        jobId,
        noteText: createNoteDto.noteText,
      },
    });
    return;
  }

  @Put(':jobId/notes/:noteId')
  @AllowMetatenant('job.metatenant.update')
  async updateNote(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Param('noteId', ParseIntPipe) noteId: number,
    @Body() updateNoteDto: PutJobNoteDto
  ) {
    try {
      await this.prisma.jobNote.update({
        where: { id: noteId, jobId },
        data: { noteText: updateNoteDto.noteText },
      });
    } catch (error) {
      // this could occur if the note ID and job ID don't line up.
      this.logger.error(`Error updating note ${noteId} for job ${jobId}: ${error}`);
      throw new NotFoundException(`Note not found: ${noteId} for job ${jobId}`);
    }
    return;
  }

  @Delete(':jobId/notes/:noteId')
  @AllowMetatenant('job.metatenant.update')
  async deleteNote(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Param('noteId', ParseIntPipe) noteId: number
  ) {
    try {
      await this.prisma.jobNote.delete({
        where: { id: noteId, jobId },
      });
    } catch (error) {
      // most likely note ID and job ID don't line up.
      this.logger.error(`Error deleting note ${noteId} for job ${jobId}: ${error}`);
      throw new NotFoundException(`Note not found: ${noteId} for job ${jobId}`);
    }
    return;
  }
}
