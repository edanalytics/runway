import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PRISMA_APP_USER } from '../database';
import { PrismaClient } from '@prisma/client';
import { JobsService } from './jobs.service';
import { Tenant } from '../auth/helpers/tenant.decorator';
import { SkipTenantOwnership } from '../auth/authorization/skip-tenant-ownership.decorator';
import type { Tenant as TTenant, User } from '@prisma/client';
import {
  GetJobDto,
  NOTE_CHAR_LIMIT,
  PostJobDto,
  PostJobResponseDto,
  PutJobResolveDto,
  toGetJobDto,
  toGetRunUpdateDto,
  toJobErrorWrapperDto,
} from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { TenantOwnership } from '../auth/authorization/tenant-ownership.guard';
import { PostJobNoteDto, PutJobNoteDto, toGetJobNoteDto } from 'models/src/dtos/job-note.dto';

@Controller()
@ApiTags('Job')
@UseGuards(new TenantOwnership('job'))
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
        runs: {
          include: {
            runOutputFile: true,
          },
        },
        files: true,
        createdBy: true,
      },
    });

    return toGetJobDto(jobs);
  }

  @Get(':jobId')
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
            runOutputFile: true,
          },
        },
      },
    });

    if (!job) {
      return new NotFoundException(`Job not found: ${jobId}`);
    }

    return toGetJobDto(job);
  }

  @Get(':jobId/files/:templateKey')
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

  @Get(':jobId/output-files/:fileName')
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
  async getStatusUpdates(
    @Param('jobId', new ParseIntPipe())
    jobId: number
  ) {
    const updates = await this.jobService.getStatusUpdates(jobId);
    return updates ? toGetRunUpdateDto(updates) : null;
  }

  @Get(':jobId/errors')
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

    // ─── Look up and validate ODS ─────────────────────────────────────────────
    await this.prisma.odsConfig
      .findUniqueOrThrow({
        where: {
          retired: false,
          tenant: {
            code: tenant.code,
            partnerId: tenant.partnerId,
          },
          id: createJobDto.odsId,
          activeConnection: {
            schoolYearId: createJobDto.schoolYearId,
          },
        },
      })
      .catch(() => {
        this.logger.error(
          `Invalid ODS selected: ODS ID: ${createJobDto.odsId}, School Year: ${createJobDto.schoolYearId}, Tenant: ${tenant.code}, Partner: ${tenant.partnerId}`
        );
        throw new BadRequestException(`Invalid ODS selected: ${createJobDto.odsId}`);
      });

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
        odsId: createJobDto.odsId,
        schoolYearId: createJobDto.schoolYearId,
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
      return toGetJobDto(updatedJob);
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
  async resolve(
    @Param('jobId', ParseIntPipe) jobId: GetJobDto['id'],
    @Body() resolveJobDto: PutJobResolveDto
  ) {
    const job = toGetJobDto(
      await this.prisma.job
        .findUniqueOrThrow({
          where: { id: jobId },
          include: {
            files: true,
            runs: {
              include: {
                runOutputFile: true,
              },
            },
          },
        })
        .catch(() => {
          // not founds should be thrown before we get to the handler, but just in case
          throw new NotFoundException(`Job not found: ${jobId}`);
        })
    );

    if (!job.isStatusChangeable) {
      throw new BadRequestException(`Job is not changeable: ${jobId}`);
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: { isResolved: resolveJobDto.isResolved },
    });

    return;
  }

  @Get(':jobId/notes')
  async getNotes(@Param('jobId', ParseIntPipe) jobId: number) {
    const notes = await this.prisma.jobNote.findMany({
      where: { jobId },
      include: { createdBy: true, modifiedBy: true },
      orderBy: { createdOn: 'asc' },
    });
    return toGetJobNoteDto(notes);
  }

  @Post(':jobId/notes')
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
