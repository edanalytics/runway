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
import { EarthbeamRunService } from '../earthbeam/earthbeam-run.service';
import { EarthbeamBundlesService } from '../earthbeam/earthbeam-bundles.service';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  constructor(
    @Inject(PRISMA_READ_ONLY) private prisma: PrismaClient,
    private fileService: FileService,
    private earthbeamService: EarthbeamRunService,
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
    prisma: PrismaClient
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
    const requiredParams =
      bundle.input_params?.filter((p) => p.is_required && p.env_var !== 'API_YEAR') ?? []; // We use the ODS to supply API_YEAR rathern than take it as input
    const incomingParams = Object.keys(input.params);
    const missingParams = requiredParams
      .filter((p) => !incomingParams.includes(p.env_var))
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
        return (
          value !== null && value !== undefined && !bundleParam.allowed_values?.includes(value)
        );
      })
      .map((p) => p.env_var);

    if (invalidParams.length > 0) {
      return {
        status: 'error',
        code: 'invalid_param_values',
        message: `Invalid param values: ${invalidParams.join(', ')}`,
      };
    }

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

    // Enrich flat params with bundle metadata for storage.
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
        inputParams: enrichedParams as unknown as JsonArray,
        configStatus: 'input_complete',
        tenantCode: tenant.code,
        partnerId: tenant.partnerId,
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

    const updatedJob = await prisma.job.update({
      where: { id: job.id },
      data: {
        fileProtocol: 's3',
        fileBucketOrHost: this.appConfig.s3Bucket(),
        fileBasePath: basePath,
        files: { createMany: { data: files } },
      },
      include: { files: true },
    });

    return { status: 'success', job: updatedJob };
  }

  async getUploadUrls(files: JobFile[]) {
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
    if (
      job.configStatus !== 'input_complete' ||
      job.files.some((file) => file.status !== 'upload_complete')
    ) {
      return { result: 'JOB_CONFIG_INCOMPLETE', job };
    }

    return await this.earthbeamService.start(job, prisma);
  }
}
