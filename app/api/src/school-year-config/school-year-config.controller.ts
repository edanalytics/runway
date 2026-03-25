import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  Headers,
  Inject,
  ParseArrayPipe,
  Put,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient, Tenant } from '@prisma/client';
import { PutSchoolYearConfigRowDto, toGetSchoolYearConfigDto } from '@edanalytics/models';
import { Response } from 'express';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { Tenant as TenantDecorator } from '../auth/helpers/tenant.decorator';

const ETAG_HEADER = 'etag';
const IF_MATCH_HEADER = 'if-match';
const CACHE_CONTROL_HEADER = 'cache-control';

const toEtag = (value: Date) => `"${value.toISOString()}"`;

@ApiTags('SchoolYearConfig')
@Controller()
export class SchoolYearConfigController {
  constructor(@Inject(PRISMA_APP_USER) private prisma: PrismaClient) {}

  @Authorize('school-year-config.read')
  @Get()
  async getConfig(@TenantDecorator() tenant: Tenant, @Res({ passthrough: true }) res: Response) {
    const partnerId = tenant.partnerId;

    const schoolYears = await this.prisma.schoolYear.findMany({
      orderBy: { startYear: 'desc' },
      include: {
        schoolYearConfig: {
          where: { partnerId },
        },
        odsConfig: {
          where: { partnerId, retired: false },
          select: { id: true },
        },
      },
    });

    let maxModifiedOn: Date | null = null;
    for (const sy of schoolYears) {
      const config = sy.schoolYearConfig[0];
      if (config && (!maxModifiedOn || config.modifiedOn > maxModifiedOn)) {
        maxModifiedOn = config.modifiedOn;
      }
    }

    res.setHeader(CACHE_CONTROL_HEADER, 'no-cache');
    if (maxModifiedOn) {
      res.setHeader(ETAG_HEADER, toEtag(maxModifiedOn));
    }

    return toGetSchoolYearConfigDto(schoolYears.map((sy) => {
      const config = sy.schoolYearConfig[0] ?? null;
      return {
        schoolYearId: sy.id,
        startYear: sy.startYear,
        endYear: sy.endYear,
        isEnabled: config?.isEnabled ?? false,
        sendToOds: config?.sendToOds ?? true,
        odsCount: sy.odsConfig.length,
      };
    }));
  }

  @Authorize('school-year-config.update')
  @Put()
  async updateConfig(
    @TenantDecorator() tenant: Tenant,
    @Headers(IF_MATCH_HEADER) ifMatchHeader: string | undefined,
    @Body(new ParseArrayPipe({ items: PutSchoolYearConfigRowDto })) body: PutSchoolYearConfigRowDto[],
  ) {
    const partnerId = tenant.partnerId;
    const ifMatch = ifMatchHeader ?? null;

    // Validate all submitted schoolYearIds exist
    if (body.length > 0) {
      const submittedIds = body.map((r) => r.schoolYearId);
      const validYears = await this.prisma.schoolYear.findMany({
        where: { id: { in: submittedIds } },
        select: { id: true },
      });
      const validIds = new Set(validYears.map((y) => y.id));
      const invalid = submittedIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException(`Invalid school year IDs: ${invalid.join(', ')}`);
      }
    }

    // Optimistic concurrency check
    const latestConfig = await this.prisma.schoolYearConfig.findFirst({
      where: { partnerId },
      orderBy: { modifiedOn: 'desc' },
      include: { user: true },
    });

    const latestModifiedOn = latestConfig?.modifiedOn ?? null;
    const currentLastModifiedOn = latestModifiedOn ? latestModifiedOn.toISOString() : null;
    const currentEtag = latestModifiedOn ? toEtag(latestModifiedOn) : null;
    const lastModifiedBy = latestConfig?.user
      ? `${latestConfig.user.givenName} ${latestConfig.user.familyName}`
      : null;
    const missingIfMatchForExistingConfig = ifMatch === null && latestConfig !== null;
    const mismatchedIfMatch = ifMatch !== null && currentEtag !== null && ifMatch !== currentEtag;
    const ifMatchProvidedForMissingConfig = ifMatch !== null && currentEtag === null;

    // Compare validators: if client sent null, current must also be null (no rows exist).
    // This is still a check-then-write flow, so concurrent requests can both pass the
    // precondition before either writes. That's acceptable for now because this is a
    // low-frequency admin config surface and last-writer-wins is tolerable here.
    if (missingIfMatchForExistingConfig || mismatchedIfMatch || ifMatchProvidedForMissingConfig) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Config has been modified since you loaded it.',
        etag: currentEtag,
        lastModifiedOn: currentLastModifiedOn,
        lastModifiedBy,
      });
    }

    // Bulk upsert — audit columns (modified_on, modified_by_id) are set by DB triggers
    await this.prisma.$transaction(
      body.map((row) =>
        this.prisma.schoolYearConfig.upsert({
          where: {
            partnerId_schoolYearId: { partnerId, schoolYearId: row.schoolYearId },
          },
          create: {
            partnerId,
            schoolYearId: row.schoolYearId,
            isEnabled: row.isEnabled,
            sendToOds: row.sendToOds,
          },
          update: {
            isEnabled: row.isEnabled,
            sendToOds: row.sendToOds,
          },
        })
      )
    );

    return { status: 'ok' };
  }
}
