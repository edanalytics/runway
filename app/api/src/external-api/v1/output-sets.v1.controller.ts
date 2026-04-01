import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from 'api/src/auth/login/public.decorator';
import { ExternalApiTokenGuard } from '../auth/external-api-token.guard';
import { ExternalApiScope, ExternalApiScopeType } from '../auth/external-api-scope.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExternalApiScopes } from '../external-api-token-scopes.decorator';
import { PrismaClient } from '@prisma/client';
import { PRISMA_READ_ONLY } from 'api/src/database/database.service';
import { isPartnerAllowed } from '../auth/external-api-partner-scope.helpers';
import { FileService } from 'api/src/files/file.service';

@Controller('output-sets')
@ApiTags('External API - Output Sets')
@ApiBearerAuth()
@Public()
@UseGuards(ExternalApiTokenGuard)
export class ExternalApiV1OutputSetsController {
  constructor(
    @Inject(PRISMA_READ_ONLY) private readonly prismaRO: PrismaClient,
    private readonly fileService: FileService
  ) {}

  @Get()
  @ExternalApiScope('read:jobs')
  async list(
    @ExternalApiScopes() scopes: ExternalApiScopeType[],
    @Query('partner') partner: string | undefined,
    @Query('tenant') tenant: string | undefined,
    @Query('schoolYear') schoolYear: string | undefined,
    @Query('sentToOds') sentToOds: string | undefined,
    @Query('createdAfter') createdAfter: string | undefined,
    @Query('bundle') bundle: string | undefined
  ) {
    if (!partner) {
      throw new BadRequestException('partner query parameter is required');
    }

    if (!isPartnerAllowed(scopes, partner)) {
      throw new NotFoundException(`Partner not found: ${partner}`);
    }

    if (sentToOds !== undefined && sentToOds !== 'true' && sentToOds !== 'false') {
      throw new BadRequestException('sentToOds must be "true" or "false"');
    }

    if (createdAfter !== undefined) {
      const parsed = new Date(createdAfter);
      if (isNaN(parsed.getTime())) {
        throw new BadRequestException('createdAfter must be a valid ISO 8601 date');
      }
    }

    // Resolve schoolYear end year to school_year.id if provided
    let schoolYearId: string | undefined;
    if (schoolYear) {
      if (!/^\d{4}$/.test(schoolYear)) {
        throw new BadRequestException('schoolYear must be a 4-digit end year, e.g. "2026"');
      }
      const sy = await this.prismaRO.schoolYear.findUnique({
        where: { endYear: parseInt(schoolYear) },
      });
      if (!sy) {
        return { data: [] };
      }
      schoolYearId = sy.id;
    }

    const sets = await this.prismaRO.runOutputFileSet.findMany({
      where: {
        run: {
          status: 'success',
          job: {
            partnerId: partner,
            ...(tenant && { tenantCode: tenant }),
            ...(schoolYearId && { schoolYearId }),
            ...(bundle && { template: { path: ['path'], equals: bundle } }),
          },
        },
        ...(sentToOds !== undefined && { sentToOds: sentToOds === 'true' }),
        ...(createdAfter && { createdOn: { gt: new Date(createdAfter) } }),
      },
      include: {
        run: {
          include: {
            job: {
              include: {
                schoolYear: true,
              },
            },
          },
        },
      },
      orderBy: { createdOn: 'asc' },
    });

    // TODO: run.status = 'success' filter — there's a plausible case where a run
    // produces a valid output set before failing. Filtering to success is the safe
    // default for v1; revisit if needed.

    return {
      data: sets.map((set) => ({
        uid: set.uid,
        files: set.files,
        sentToOds: set.sentToOds,
        createdAt: set.createdOn.toISOString(),
        jobUid: set.run.job.uid,
        partner: set.run.job.partnerId,
        tenant: set.run.job.tenantCode,
        schoolYear: String(set.run.job.schoolYear.endYear),
        bundle: (set.run.job.template as any)?.path ?? null,
      })),
    };
  }

  @Post(':setUid/download-links')
  @HttpCode(200)
  @ExternalApiScope('read:jobs:output-files')
  async downloadLinks(
    @ExternalApiScopes() scopes: ExternalApiScopeType[],
    @Param('setUid', ParseUUIDPipe) setUid: string
  ) {
    const set = await this.prismaRO.runOutputFileSet.findUnique({
      where: { uid: setUid },
      include: {
        run: {
          include: {
            job: true,
          },
        },
      },
    });

    if (!set || !isPartnerAllowed(scopes, set.run.job.partnerId)) {
      throw new NotFoundException('Output file set not found');
    }

    const files = set.files as string[];
    const downloadLinks: Record<string, string> = {};

    for (const filename of files) {
      const fullPath = `${set.path}/${filename}`;
      downloadLinks[filename] = await this.fileService.getPresignedDownloadUrl({
        fullPath,
        nameForDownload: filename,
      });
    }

    return { downloadLinks };
  }
}
