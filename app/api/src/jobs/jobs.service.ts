import {
  EarthmoverBundleTypes,
  JsonArray,
  PostJobDto,
  toGetJobTemplateDto,
} from '@edanalytics/models';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FileStatus, Job, JobFile, PrismaClient, Tenant } from '@prisma/client';
import { FileService } from '../files/file.service';
import { PRISMA_READ_ONLY } from '../database';
import { instanceToPlain } from 'class-transformer';
import { EarthbeamBundlesService } from '../earthbeam/earthbeam-bundles.service';
import { AppConfigService } from '../config/app-config.service';
import { ExecutorService } from '../earthbeam/executor/executor.abstract.service';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { pipeline } from 'stream/promises';
import * as path from 'path';
import { Readable } from 'stream';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  constructor(
    @Inject(PRISMA_READ_ONLY) private prisma: PrismaClient,
    private fileService: FileService,
    private executor: ExecutorService,
    private bundleService: EarthbeamBundlesService,
    private appConfig: AppConfigService
  ) {}

  async getStatusUpdates(jobId: Job['id']) {
    const lastRun = await this.prisma.run.findFirst({
      where: { jobId },
      orderBy: { createdOn: 'desc' },
      include: { runUpdate: true },
    });
    return lastRun?.runUpdate;
  }

  async getErrors(jobId: Job['id']) {
    const lastRun = await this.prisma.run.findFirst({
      where: { jobId },
      orderBy: { createdOn: 'desc' },
      include: { runError: true },
    });
    return lastRun?.runError;
  }

  async initialize(data: PostJobDto, tenant: Tenant, prisma: PrismaClient) {
    // We grab the bundle fresh because we shouldn't trust the template that comes
    // in on the request. The executor uses template keys as env vars. We don't want to
    // allow users to inject arbitrary env vars.
    const bundle = await this.bundleService.getBundle(
      EarthmoverBundleTypes.assessments,
      data.template.path
    );

    if (!bundle) {
      throw new Error('Bundle not found');
    }

    const job = await prisma.job.create({
      data: {
        name: data.name,
        odsId: data.odsId,
        schoolYearId: data.schoolYearId,
        template: instanceToPlain(toGetJobTemplateDto(bundle)), // template takes JSON, so need to convert to plain object
        inputParams: data.inputParams as unknown as JsonArray, // inputParams is a JSON array
        configStatus: 'input_complete', // TODO: job config used to be a multi-step process, but not anymore and this col should probably be removed
        tenantCode: tenant.code,
        partnerId: tenant.partnerId,
      },
    });

    const basePath = [tenant.partnerId, tenant.code, job.schoolYearId, job.id]
      .map(encodeURIComponent) // Tenant code is the particular concern but let's take care of all potential encoding issues
      .join('/');

    const files = data.files.map((file) => {
      const nameInternal = `${file.templateKey}__${file.nameFromUser}`;
      return {
        ...file,
        nameInternal,
        path: `${basePath}/input/${nameInternal}`,
      };
    });

    const isLocalExecutor = this.appConfig.isLocalExecutor();
    const localStorageRoot = isLocalExecutor ? this.appConfig.localExecutorStorageRoot() : undefined;
    if (isLocalExecutor && !localStorageRoot) {
      throw new Error('Local executor storage root is not configured');
    }

    return prisma.job.update({
      where: { id: job.id },
      data: {
        fileProtocol: isLocalExecutor ? 'file' : 's3',
        fileBucketOrHost: isLocalExecutor ? localStorageRoot : this.appConfig.s3Bucket(),
        fileBasePath: basePath,
        files: { createMany: { data: files } },
      },
      include: { files: true },
    });
  }

  async getUploadUrls(files: JobFile[]) {
    if (this.appConfig.isLocalExecutor()) {
      const baseUrl = this.appConfig.get('MY_URL')?.replace(/\/+$/, '') ?? '';
      return files.map((file) => ({
        templateKey: file.templateKey,
        url: `${baseUrl}/api/jobs/${file.jobId}/files/${file.templateKey}/upload`,
      }));
    }

    return Promise.all(
      files.map(async (file) => ({
        templateKey: file.templateKey,
        url: await this.fileService.getPresignedUploadUrl({
          fullPath: file.path,
          fileType: file.type,
        }),
      }))
    );
  }

  async getDownloadUrlForInputFile(jobId: Job['id'], templateKey: JobFile['templateKey']) {
    if (this.appConfig.isLocalExecutor()) {
      const baseUrl = this.appConfig.get('MY_URL')?.replace(/\/+$/, '') ?? '';
      return `${baseUrl}/api/jobs/${jobId}/files/${templateKey}/download`;
    }

    const file = await this.prisma.jobFile.findUnique({
      where: { jobId_templateKey: { jobId, templateKey } },
    });

    if (!file) {
      return null;
    }
    return this.fileService.getPresignedDownloadUrl({
      fullPath: file.path,
      nameForDownload: file.nameFromUser,
    });
  }

  async getDownloadUrlForOutputFile(jobId: Job['id'], fileName: string) {
    if (this.appConfig.isLocalExecutor()) {
      const baseUrl = this.appConfig.get('MY_URL')?.replace(/\/+$/, '') ?? '';
      return `${baseUrl}/api/jobs/${jobId}/output-files/${encodeURIComponent(
        fileName
      )}/download`;
    }

    const file = await this.prisma.runOutputFile.findFirst({
      where: { run: { jobId }, name: fileName },
      orderBy: { runId: 'desc' },
    });

    if (!file) {
      return null;
    }
    return this.fileService.getPresignedDownloadUrl({
      fullPath: file.path,
      nameForDownload: file.name,
    });
  }

  async updateFileStatusForJob(jobId: Job['id'], status: FileStatus, prisma: PrismaClient) {
    return prisma.job.update({
      where: { id: jobId },
      data: {
        files: { updateMany: { where: { jobId }, data: { status } } },
      },
      include: { files: true },
    });
  }

  async startJob(job: Job & { files: JobFile[] }, prisma: PrismaClient) {
    // TODO: move into controller?
    if (
      job.configStatus !== 'input_complete' ||
      job.files.some((file) => file.status !== 'upload_complete')
    ) {
      return { result: 'JOB_CONFIG_INCOMPLETE', job };
    }

    const runs = await prisma.run.findMany({ where: { jobId: job.id } });
    if (runs.some((run) => run.status === 'running' || run.status === 'new')) {
      return { result: 'JOB_IN_PROGRESS', job };
    }

    const run = await prisma.run.create({
      data: {
        jobId: job.id,
        status: 'new', // it may take aws a few min to start the run, so we won't update this status as part of this function
      },
      include: { job: true },
    });

    try {
      await this.executor.start(run);
    } catch (e) {
      this.logger.error(`Failed to start run ${run.id}: ${e}`);

      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'error',
          runError: {
            create: {
              code: 'failed_to_start_executor',
              payload: { stacktrace: 'stacktrace unavailable' },
            },
          },
          runUpdate: {
            create: {
              action: 'done',
              status: 'failure',
            },
          },
        },
      });

      return { result: 'JOB_START_FAILED', job, error: e };
    }

    return { result: 'JOB_STARTED', job, run };
  }

  async saveLocalUpload(
    jobId: Job['id'],
    templateKey: JobFile['templateKey'],
    stream: Readable
  ) {
    if (!this.appConfig.isLocalExecutor()) {
      throw new Error('Local upload is only available in local executor mode');
    }

    const file = await this.prisma.jobFile.findUnique({
      where: { jobId_templateKey: { jobId, templateKey } },
    });

    if (!file) {
      return null;
    }

    const destination = this.fileService.localFilePath(file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await pipeline(stream, createWriteStream(destination));
    return file;
  }

  async getLocalInputFileForDownload(
    jobId: Job['id'],
    templateKey: JobFile['templateKey']
  ) {
    if (!this.appConfig.isLocalExecutor()) {
      throw new Error('Local download is only available in local executor mode');
    }

    const file = await this.prisma.jobFile.findUnique({
      where: { jobId_templateKey: { jobId, templateKey } },
    });

    if (!file) {
      return null;
    }

    return {
      file,
      path: this.fileService.localFilePath(file.path),
    };
  }

  async getLocalOutputFileForDownload(jobId: Job['id'], fileName: string) {
    if (!this.appConfig.isLocalExecutor()) {
      throw new Error('Local download is only available in local executor mode');
    }

    const file = await this.prisma.runOutputFile.findFirst({
      where: { run: { jobId }, name: fileName },
      orderBy: { runId: 'desc' },
    });

    if (!file) {
      return null;
    }

    return {
      file,
      path: this.fileService.localFilePath(file.path),
    };
  }
}
