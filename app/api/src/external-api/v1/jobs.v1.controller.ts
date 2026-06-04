import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
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
import { InitJobPayloadV1Dto, toInitJobResponseV1Dto } from '@edanalytics/models';
import { FileService } from 'api/src/files/file.service';
import { AppConfigService } from 'api/src/config/app-config.service';
import { ApiTokenClient, ExternalApiTokenClient } from '../external-api-token-client.decorator';

@Controller('jobs')
@ApiTags('External API - Jobs')
@ApiBearerAuth() // Does not impact actual auth. Rather, it tells Swagger to include a bearer token when sending requests to these endpoints.
@Public() // do not require a session
@UseGuards(ExternalApiTokenGuard) // but do require a valid token
export class ExternalApiV1JobsController {
  private readonly logger = new Logger(ExternalApiV1JobsController.name);
  constructor(
    private readonly jobsService: JobsService,
    @Inject(PRISMA_READ_ONLY) private readonly prismaRO: PrismaClient,
    @Inject(PRISMA_ANONYMOUS) private readonly prismaAnon: PrismaClient,
    private readonly fileService: FileService,
    private readonly appConfig: AppConfigService,
  ) {}

  @Post()
  @ExternalApiScope('create:jobs')
  async initialize(
    @ExternalApiScopes() scopes: ExternalApiScopeType[],
    @ExternalApiTokenClient() apiClient: ApiTokenClient,
    @Body() jobInitDto: InitJobPayloadV1Dto
  ) {
    const { partner: partnerId, tenant: tenantCode } = jobInitDto;

    // ─── Validate existence of client ID in token ───────────────────────────────
    if (!apiClient.clientId) {
      // Should never happen, but if it does we shouldn't create the job since we
      // can't attribute it to a client.
      throw new ForbiddenException('Token must include a client_id or azp claim');
    }

    // ─── Validate partner ─────────────────────────────────────────────────────
    if (!isPartnerAllowed(scopes, partnerId)) {
      throw new ForbiddenException(`Invalid partner code: ${partnerId}`);
    }

    // ─── Validate tenant ──────────────────────────────────────────────────────
    const tenant = await this.prismaRO.tenant.findUnique({
      where: {
        code_partnerId: {
          code: tenantCode,
          partnerId: partnerId,
        },
      },
    });

    if (!tenant) {
      throw new BadRequestException(`Invalid tenant. ${partnerId}/${tenantCode} does not exist`);
    }

    // ─── Validate bundle enablement for partner ──────────────────────────────────
    const bundle = await this.prismaRO.partnerEarthmoverBundle.findUnique({
      where: {
        partnerId_earthmoverBundleKey: {
          partnerId: partnerId,
          earthmoverBundleKey: jobInitDto.bundle,
        },
      },
    });

    if (!bundle) {
      throw new BadRequestException(
        `Bundle not found or not enabled for partner: ${jobInitDto.bundle}`
      );
    }

    const schoolYear = await this.prismaRO.schoolYear.findUnique({
      where: {
        endYear: parseInt(jobInitDto.schoolYear),
      },
    });
    if (!schoolYear) {
      throw new BadRequestException(`Invalid school year: ${jobInitDto.schoolYear}`);
    }

    const destination = await this.jobsService.resolveJobDestination({
      schoolYearId: schoolYear.id,
      tenant,
    });
    if (destination.status === 'error') {
      const year = jobInitDto.schoolYear;
      const messages: Record<typeof destination.code, string> = {
        school_year_config_missing: `School year is not enabled: ${year}`,
        school_year_disabled: `School year is not enabled: ${year}`,
        ods_not_found: `No ODS found for school year: ${year}`,
        roster_unavailable: `No roster file found and cross-year matching not enabled for school year: ${year}`,
      };
      throw new BadRequestException(messages[destination.code]);
    }

    // ─── Create job ───────────────────────────────────────────────────────────
    const result = await this.jobsService.createJob(
      {
        bundlePath: jobInitDto.bundle,
        odsId: destination.data.odsId,
        sendToOds: destination.data.sendToOds,
        schoolYearId: destination.data.schoolYearId,
        files: Object.entries(jobInitDto.files).map(([envVar, fileName]) => ({
          templateKey: envVar,
          nameFromUser: fileName,
          type: 'application/octet-stream',
        })),
        params: jobInitDto.params ?? {},
      },
      tenant,
      this.prismaAnon,
      apiClient
    );

    if (result.status === 'error') {
      if (result.code === 'bundle_not_found') {
        // If we passed the bundle enablement check above, but fail to retrieve the bundle,
        // that's a server error and not a bad request.
        throw new InternalServerErrorException(result.message);
      } else {
        // Other errors are bad requests, various ways that the input doesn't line up with
        // what the bundle metadata expects. Calls should succeed if they adjust their input.
        throw new BadRequestException(result.message);
      }
    }

    // ─── Get upload URLs ──────────────────────────────────────────────────────
    const uploadUrls = await this.jobsService.getUploadUrls(result.job.files);
    return toInitJobResponseV1Dto({
      uid: result.job.uid,
      uploadUrls: Object.fromEntries(uploadUrls.map((u) => [u.templateKey, u.url])),
    });
  }

  @Post(':jobUid/start')
  @HttpCode(202)
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

    const filesExist = await this.fileService.doFilesExist(job.files.map((f) => f.path), this.appConfig.s3Bucket());
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
