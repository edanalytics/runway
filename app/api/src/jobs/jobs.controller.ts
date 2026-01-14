import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PRISMA_APP_USER } from '../database';
import { PrismaClient } from '@prisma/client';
import { JobsService } from './jobs.service';
import { Tenant } from '../auth/helpers/tenant.decorator';
import { SkipTenantOwnership } from '../auth/authorization/skip-tenant-ownership.decorator';
import type { Tenant as TTenant } from '@prisma/client';
import {
  GetJobDto,
  PostJobDto,
  PostJobResponseDto,
  toGetJobDto,
  toGetRunUpdateDto,
  toJobErrorWrapperDto,
} from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { TenantOwnership } from '../auth/authorization/tenant-ownership.guard';
import { EarthbeamBundlesService } from '../earthbeam/earthbeam-bundles.service';
import { EarthmoverBundleTypes } from '@edanalytics/models';
import { Request, Response } from 'express';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

@Controller()
@ApiTags('Job')
@UseGuards(new TenantOwnership('job'))
export class JobsController {
  private logger = new Logger(JobsController.name);
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private jobService: JobsService,
    private bundleService: EarthbeamBundlesService
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

  @Put(':jobId/files/:templateKey/upload')
  @HttpCode(201)
  async uploadLocalInputFile(
    @Param('jobId', new ParseIntPipe()) jobId: number,
    @Param('templateKey') templateKey: string,
    @Req() req: Request
  ) {
    const file = await this.jobService.saveLocalUpload(jobId, templateKey, req);
    if (!file) {
      return new NotFoundException(
        `File not found for job ${jobId} and template key ${templateKey}`
      );
    }
    return { ok: true };
  }

  @Get(':jobId/files/:templateKey/download')
  async downloadLocalInputFile(
    @Param('jobId', new ParseIntPipe()) jobId: number,
    @Param('templateKey') templateKey: string,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.jobService.getLocalInputFileForDownload(jobId, templateKey);
    if (!result) {
      return new NotFoundException(
        `File not found for job ${jobId} and template key ${templateKey}`
      );
    }

    await stat(result.path).catch(() => {
      throw new NotFoundException(`File missing on disk for job ${jobId}`);
    });

    res.setHeader('Content-Disposition', `attachment; filename="${result.file.nameFromUser}"`);
    if (result.file.type) {
      res.setHeader('Content-Type', result.file.type);
    }
    return new StreamableFile(createReadStream(result.path));
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

  @Get(':jobId/output-files/:fileName/download')
  async downloadLocalOutputFile(
    @Param('jobId', new ParseIntPipe()) jobId: number,
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response
  ) {
    const decodedFilename = decodeURIComponent(fileName);
    const result = await this.jobService.getLocalOutputFileForDownload(jobId, decodedFilename);
    if (!result) {
      return new NotFoundException(
        `File not found for job ${jobId} and file ${decodedFilename}`
      );
    }

    await stat(result.path).catch(() => {
      throw new NotFoundException(`File missing on disk for job ${jobId}`);
    });

    res.setHeader('Content-Disposition', `attachment; filename="${result.file.name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    return new StreamableFile(createReadStream(result.path));
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
   * 4. Upload files in S3
   * 5. Send the job to ECS
   */
  @Post()
  @SkipTenantOwnership()
  async initialize(@Body() createJobDto: PostJobDto, @Tenant() tenant: TTenant) {
    const bundle = await this.bundleService.getBundle(
      EarthmoverBundleTypes.assessments,
      createJobDto.template.path
    );

    if (!bundle) {
      throw new BadRequestException(`Bundle not found: ${createJobDto.template.path}`);
    }

    const allowedBundles = await this.prisma.partnerEarthmoverBundle.findMany({
      where: {
        partnerId: tenant.partnerId,
        earthmoverBundleKey: bundle.path,
      },
    });

    if (!allowedBundles.find((b) => b.earthmoverBundleKey === bundle.path)) {
      throw new BadRequestException(`Bundle not allowed for partner: ${bundle.path}`);
    }

    const ods = await this.prisma.odsConfig.findUnique({
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
    });

    if (!ods) {
      this.logger.error(
        `Invalid ODS selected: ODS ID: ${createJobDto.odsId}, School Year: ${createJobDto.schoolYearId}, Tenant: ${tenant.code}, Partner: ${tenant.partnerId}`
      );
      throw new BadRequestException(`Invalid ODS selected: ${createJobDto.odsId}`);
    }

    const job = await this.jobService.initialize(createJobDto, tenant, this.prisma);
    const uploadUrls = await this.jobService.getUploadUrls(job.files);

    return plainToInstance(PostJobResponseDto, {
      id: job.id,
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
}
