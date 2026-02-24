import {
  EarthmoverBundleTypes,
  JobInputParamDto,
  JsonArray,
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
import { ApiTokenClient } from '../external-api/external-api-token-client.decorator';

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

  /**
   * Creates a new job with validated inputs.
   *
   * Controllers are responsible for:
   * - Auth/authorization
   * - Tenant and ODS lookup/validation
   * - Verifying bundle is enabled for partner
   *
   * This method handles:
   * - Fetching bundle (for security - don't trust client-provided template)
   * - Validating params against bundle requirements
   * - Validating files against bundle requirements
   * - Creating job and file records
   */
  async createJob(
    input: {
      bundlePath: string;
      odsId: number;
      schoolYearId: string;
      files: Array<{ templateKey: string; nameFromUser: string; type: string }>;
      params: Record<string, string>;
    },
    tenant: Tenant,
    prisma: PrismaClient,
    apiClient?: ApiTokenClient
  ): Promise<
    | { status: 'success'; job: Job & { files: JobFile[] } }
    | {
        status: 'error';
        code:
          | 'bundle_not_found'
          | 'missing_required_params'
          | 'invalid_param_values'
          | 'unexpected_params'
          | 'missing_required_files'
          | 'unexpected_files';
        message: string;
      }
  > {
    const bundle = await this.bundleService.getBundle(
      EarthmoverBundleTypes.assessments,
      input.bundlePath
    );

    if (!bundle) {
      return {
        status: 'error',
        code: 'bundle_not_found',
        message: `Bundle not found: ${input.bundlePath}`,
      };
    }

    // ─── Validate params ────────────────────────────────────────────────────
    // Params are validated against bundle metadata. For the EA instance, these can be found in the registry.json file:
    // https://raw.githubusercontent.com/edanalytics/earthmover_edfi_bundles/refs/heads/main/registry.json
    //
    // The registry.json file compiles and jsonifies the metadata.yaml files that live in each bundle's directory.
    //  Example metadata.yaml: https://github.com/edanalytics/earthmover_edfi_bundles/blob/main/assessments/PSAT_SAT/_metadata.yaml
    const requiredParams =
      bundle.input_params?.filter((p) => p.is_required && p.env_var !== 'API_YEAR') ?? []; // We use the ODS to supply API_YEAR rathern than take it as input
    const missingParams = requiredParams
      .filter((p) => input.params[p.env_var] == null)
      .map((p) => p.env_var);

    if (missingParams.length > 0) {
      return {
        status: 'error',
        code: 'missing_required_params',
        message: `Missing required params: ${missingParams.join(', ')}`,
      };
    }

    const paramsWithAllowedValues =
      bundle.input_params?.filter((p) => !!p.allowed_values?.length) ?? [];
    const invalidParams = paramsWithAllowedValues
      .filter((bundleParam) => {
        const value = input.params[bundleParam.env_var];
        return value != null && !bundleParam.allowed_values?.includes(value); // if there is a value, it must be an allowed value
      })
      .map((p) => p.env_var);

    if (invalidParams.length > 0) {
      return {
        status: 'error',
        code: 'invalid_param_values',
        message: `Invalid param values: ${invalidParams.join(', ')}`,
      };
    }

    const incomingParams = Object.keys(input.params);
    const expectedParams = bundle.input_params?.map((p) => p.env_var) ?? [];
    const unexpectedParams = incomingParams.filter((key) => !expectedParams.includes(key));
    if (unexpectedParams.length > 0) {
      return {
        status: 'error',
        code: 'unexpected_params',
        message: `Unexpected params: ${unexpectedParams.join(', ')}`,
      };
    }

    // ─── Validate files ─────────────────────────────────────────────────────
    const incomingFiles = input.files.map((f) => f.templateKey);
    const expectedFiles = bundle.input_files?.map((f) => f.env_var) ?? [];
    const unexpectedFiles = incomingFiles.filter((key) => !expectedFiles.includes(key));
    if (unexpectedFiles.length > 0) {
      return {
        status: 'error',
        code: 'unexpected_files',
        message: `Unexpected files: ${unexpectedFiles.join(', ')}`,
      };
    }

    const requiredFileKeys =
      bundle.input_files?.filter((f) => f.is_required).map((f) => f.env_var) ?? [];
    const missingFiles = requiredFileKeys.filter((key) => !incomingFiles.includes(key));
    if (missingFiles.length > 0) {
      return {
        status: 'error',
        code: 'missing_required_files',
        message: `Missing required files: ${missingFiles.join(', ')}`,
      };
    }

    // Enrich flat params with bundle metadata for storage
    const enrichedParams: JobInputParamDto[] = Object.entries(input.params).map(([key, value]) => {
      const bundleParam = bundle.input_params?.find((p) => p.env_var === key);
      return {
        templateKey: key,
        value,
        name: bundleParam?.display_name ?? key,
        isRequired: bundleParam?.is_required ?? false,
        allowedValues: bundleParam?.allowed_values,
      };
    });

    // ─── Create job ─────────────────────────────────────────────────────────
    const job = await prisma.job.create({
      data: {
        name: bundle.display_name,
        odsId: input.odsId,
        schoolYearId: input.schoolYearId,
        template: instanceToPlain(toGetJobTemplateDto(bundle)),
        inputParams: enrichedParams,
        configStatus: 'input_complete', // TODO: job config used to be a multi-step process, but not anymore and this col should probably be removed
        tenantCode: tenant.code,
        partnerId: tenant.partnerId,
        apiIssuer: apiClient?.issuer,
        apiClientId: apiClient?.clientId,
        apiClientName: apiClient?.clientName,
      },
    });

    const basePath = [tenant.partnerId, tenant.code, input.schoolYearId, job.id]
      .map(encodeURIComponent)
      .join('/');

    const files = input.files.map((file) => {
      const nameInternal = `${file.templateKey}__${file.nameFromUser}`;
      return {
        templateKey: file.templateKey,
        nameFromUser: file.nameFromUser,
        type: file.type,
        nameInternal,
        path: `${basePath}/input/${nameInternal}`,
      };
    });

    const isLocalExecutor = this.appConfig.isLocalExecutor();
    const localStorageRoot = isLocalExecutor
      ? this.appConfig.localExecutorStorageRoot()
      : undefined;
    if (isLocalExecutor && !localStorageRoot) {
      throw new Error('Local executor storage root is not configured');
    }

    const updatedJob = await prisma.job.update({
      where: { id: job.id },
      data: {
        fileProtocol: isLocalExecutor ? 'file' : 's3',
        fileBucketOrHost: isLocalExecutor ? localStorageRoot : this.appConfig.s3Bucket(),
        fileBasePath: basePath,
        files: { createMany: { data: files } },
      },
      include: { files: true },
    });

    return { status: 'success', job: updatedJob };
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
      return `${baseUrl}/api/jobs/${jobId}/output-files/${encodeURIComponent(fileName)}/download`;
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

  async saveLocalUpload(jobId: Job['id'], templateKey: JobFile['templateKey'], stream: Readable) {
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

  async getLocalInputFileForDownload(jobId: Job['id'], templateKey: JobFile['templateKey']) {
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
