import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from 'api/src/auth/login/public.decorator';
import { JobsService } from 'api/src/jobs/jobs.service';
import { ExternalApiTokenGuard } from '../auth/external-api-token.guard';
import { ExternalApiScope, ExternalApiScopeType } from '../auth/external-api-scope.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExternalApiScopes } from '../external-api-token-scopes.decorator';
import { PrismaClient } from '@prisma/client';
import { PRISMA_ANONYMOUS, PRISMA_READ_ONLY } from 'api/src/database/database.service';
import { isPartnerAllowed } from '../auth/external-api-partner-scope.helpers';
import { EarthmoverBundleTypes } from 'models/src/interfaces/earthmover-bundle.interface';
import { EarthbeamBundlesService } from 'api/src/earthbeam/earthbeam-bundles.service';
import {
  InitJobPayloadV1Dto,
  toGetJobTemplateDto,
  toInitJobResponseV1Dto,
} from '@edanalytics/models';
import { FileService } from 'api/src/files/file.service';

@Controller('jobs')
@ApiTags('External API - Jobs')
@ApiBearerAuth() // Does not impact actual auth. Rather, it tells Swagger to include a bearer token when sending requests to these endpoints.
@Public() // do not require a session
@UseGuards(ExternalApiTokenGuard) // but do require a valid token
export class ExternalApiV1JobsController {
  constructor(
    private readonly jobsService: JobsService,
    @Inject(PRISMA_READ_ONLY) private readonly prismaRO: PrismaClient,
    @Inject(PRISMA_ANONYMOUS) private readonly prismaAnon: PrismaClient,
    private readonly bundleService: EarthbeamBundlesService,
    private readonly fileService: FileService
  ) {}

  @Post()
  @ExternalApiScope('create:jobs')
  async initialize(
    @ExternalApiScopes() scopes: ExternalApiScopeType[],
    @Body() jobInitDto: InitJobPayloadV1Dto
  ) {
    const { partner: partnerId, tenant: tenantCode } = jobInitDto;

    // ensure there's a scope that matches the partner code from the request
    // if we end up having more endpoints with partner/tenant params, perhaps move this to a guard.
    if (!isPartnerAllowed(scopes, partnerId)) {
      throw new ForbiddenException(`Invalid partner code: ${partnerId}`);
    }

    const tenant = await this.prismaRO.tenant
      .findUniqueOrThrow({
        where: {
          code_partnerId: {
            code: tenantCode,
            partnerId: partnerId,
          },
        },
      })
      .catch(() => {
        throw new ForbiddenException(
          `Invalid tenant code: ${tenantCode} for partner: ${partnerId}`
        );
      });

    const bundle = await this.bundleService.getBundle(
      EarthmoverBundleTypes.assessments,
      jobInitDto.bundle
    );

    if (!bundle) {
      throw new BadRequestException(
        `Bundle not found: ${jobInitDto.bundle}. Bundles must be in the format "assessments/<bundle-name>"`
      );
    }

    await this.prismaRO.partnerEarthmoverBundle
      .findUniqueOrThrow({
        where: {
          partnerId_earthmoverBundleKey: {
            partnerId: partnerId,
            earthmoverBundleKey: bundle.path,
          },
        },
      })
      .catch(() => {
        throw new BadRequestException(`Bundle not enabled for partner: ${bundle.path}`);
      });

    // look up ODS based on school year
    const odsConfigs = await this.prismaRO.odsConfig.findMany({
      where: {
        activeConnection: {
          schoolYearId: jobInitDto.schoolYear,
        },
        retired: false,
        tenantCode,
        partnerId,
      },
    });

    if (odsConfigs.length === 0) {
      throw new BadRequestException(`No ODS found for school year: ${jobInitDto.schoolYear}`);
    }
    if (odsConfigs.length > 1) {
      throw new BadRequestException(`Multiple ODS found for school year: ${jobInitDto.schoolYear}`);
    }

    const incomingParams = jobInitDto.params;
    const requiredParams =
      bundle.input_params?.filter((p) => p.is_required && p.env_var !== 'API_YEAR') ?? []; // we get API_YEAR from the school year, so it's not a user-provided param
    const missingRequiredParams = requiredParams.filter(
      (p) => incomingParams?.[p.env_var] === null || incomingParams?.[p.env_var] === undefined
    );
    if (missingRequiredParams.length > 0) {
      throw new BadRequestException(
        `Missing required params: ${missingRequiredParams.map((p) => p.env_var).join(', ')}`
      );
    }

    const paramsWithAllowedValues =
      bundle.input_params?.filter((p) => !!p.allowed_values?.length) ?? [];
    const paramsWithInvalidValues = paramsWithAllowedValues.filter(
      (p) =>
        // value is passed for this param, but it's not in the allowed values
        incomingParams?.[p.env_var] !== null &&
        incomingParams?.[p.env_var] !== undefined &&
        !p.allowed_values?.includes(incomingParams?.[p.env_var])
    );

    if (paramsWithInvalidValues.length > 0) {
      throw new BadRequestException(
        `Invalid param input: ${paramsWithInvalidValues.map((p) => p.env_var).join(', ')}`
      );
    }

    const incomingFiles = jobInitDto.files;
    const expectedFiles = bundle.input_files?.map((f) => f.env_var) ?? [];
    const unexpectedFiles = Object.keys(incomingFiles).filter((f) => !expectedFiles.includes(f));
    if (unexpectedFiles.length > 0) {
      throw new BadRequestException(`Unexpected file input: ${unexpectedFiles.join(', ')}`);
    }

    const missingRequiredFiles = bundle.input_files
      ?.filter((f) => f.is_required)
      .filter((f) => !Object.keys(incomingFiles).includes(f.env_var))
      .map((f) => f.env_var);

    if (missingRequiredFiles.length > 0) {
      throw new BadRequestException(`Missing required files: ${missingRequiredFiles.join(', ')}`);
    }

    // TODO: refactor jobService.initialize to just ask for what it needs
    // and see if we can avoid passing the prisma client
    const job = await this.jobsService.initialize(
      {
        name: bundle.display_name,
        odsId: odsConfigs[0].id,
        schoolYearId: jobInitDto.schoolYear,
        files: Object.entries(incomingFiles).map(([envVar, filePath]) => ({
          templateKey: envVar,
          nameFromUser: filePath,
          type: 'file',
        })),
        inputParams: (Object.entries(incomingParams ?? {}) ?? []).map(([key, value]) => ({
          templateKey: key,
          value: value,
          name: key,
          isRequired: bundle.input_params?.find((p) => p.env_var === key)?.is_required ?? false,
        })),
        template: toGetJobTemplateDto(bundle),
        previousJobId: null,
      },
      tenant,
      this.prismaAnon
    );

    const uploadUrls = await this.jobsService.getUploadUrls(job.files);
    const returnDto = toInitJobResponseV1Dto({
      uid: job.uid,
      uploadUrls: Object.fromEntries(uploadUrls.map((u) => [u.templateKey, u.url])),
    });
    return returnDto;
  }

  @Post(':jobUid/start')
  @ExternalApiScope('create:jobs')
  async start(
    @ExternalApiScopes() scopes: ExternalApiScopeType[],
    @Param('jobUid', ParseUUIDPipe) jobUid: string
  ) {
    const job = await this.prismaRO.job.findUnique({
      where: { uid: jobUid },
      include: { files: true },
    });

    if (!job || !isPartnerAllowed(scopes, job.partnerId)) {
      // treat both bad uid and partner that doesn't match token scope as 404
      throw new NotFoundException(`Job not found: ${jobUid}`);
    }

    const filesExist = await this.fileService.doFilesExist(job.files.map((f) => f.path));
    if (!filesExist) {
      throw new BadRequestException(
        `Some expected files were not found. Expected files: ${job.files
          .map((f) => f.nameFromUser)
          .join(', ')}`
      );
    }

    const updatedJob = await this.jobsService.updateFileStatusForJob(
      job.id,
      'upload_complete',
      this.prismaAnon
    );

    const res = await this.jobsService.startJob(updatedJob, this.prismaAnon);
    if (res.result === 'JOB_STARTED') {
      return;
    } else if (res.result === 'JOB_CONFIG_INCOMPLETE') {
      throw new BadRequestException(`Job not initiated properly: ${jobUid}`);
    } else if (res.result === 'JOB_IN_PROGRESS') {
      throw new BadRequestException(`Job already in progress: ${jobUid}`);
    } else if (res.result === 'JOB_START_FAILED') {
      throw new InternalServerErrorException(`Failed to start job ${jobUid}`);
    } else {
      throw new InternalServerErrorException(`Unknown error starting job ${jobUid}`);
    }
  }
}
