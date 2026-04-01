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
import {
  PutSchoolYearConfigRowDto,
  toGetSchoolYearConfigDto,
  toGetTenantSchoolYearConfigDto,
} from '@edanalytics/models';
import { Response } from 'express';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { Tenant as TenantDecorator } from '../auth/helpers/tenant.decorator';
import { FileService } from '../files/file.service';

const toEtag = (value: Date) => `"${value.toISOString()}"`;

@ApiTags('SchoolYearConfig')
@Controller()
export class SchoolYearConfigController {
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private fileService: FileService,
  ) {}

  @Authorize('school-year-config.read')
  @Get('tenant')
  async getTenantConfig(@TenantDecorator() tenant: Tenant) {
    const schoolYears = await this.prisma.schoolYear.findMany({
      where: {
        schoolYearConfig: {
          some: {
            partnerId: tenant.partnerId,
            isEnabled: true,
          },
        },
      },
      orderBy: { startYear: 'desc' },
      include: {
        schoolYearConfig: {
          where: {
            partnerId: tenant.partnerId,
            isEnabled: true,
          },
        },
        odsConfig: {
          where: {
            partnerId: tenant.partnerId,
            tenantCode: tenant.code,
            retired: false,
            activeConnectionId: { not: null },
          },
          select: { id: true },
        },
      },
    });

    const rows = await Promise.all(
      schoolYears.map(async (schoolYear) => {
        const config = schoolYear.schoolYearConfig[0];
        if (!config) {
          throw new BadRequestException(
            `Enabled school year missing config for ${tenant.partnerId}/${schoolYear.id}`
          );
        }

        const hasRoster = config.sendToOds
          ? null
          : await this.fileService.doFilesExist([
              `__rosters/${tenant.partnerId}/${tenant.code}/${schoolYear.endYear}/studentEducationOrganizationAssociations.jsonl`,
            ]);

        return {
          schoolYearId: schoolYear.id,
          startYear: schoolYear.startYear,
          endYear: schoolYear.endYear,
          sendToOds: config.sendToOds,
          hasOds: schoolYear.odsConfig.length > 0,
          hasRoster,
        };
      })
    );

    return toGetTenantSchoolYearConfigDto(rows);
  }

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

    if (maxModifiedOn) {
      res.setHeader('etag', toEtag(maxModifiedOn));
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
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Body(new ParseArrayPipe({ items: PutSchoolYearConfigRowDto }))
    body: PutSchoolYearConfigRowDto[],
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
    const currentEtag = latestModifiedOn ? toEtag(latestModifiedOn) : null;

    // Check-then-write: concurrent requests can both pass before either writes.
    // Acceptable for a low-frequency admin config surface.
    if (ifMatch !== currentEtag) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Config has been modified since you loaded it.',
        etag: currentEtag,
        lastModifiedOn: latestModifiedOn ? latestModifiedOn.toISOString() : null,
        lastModifiedBy: latestConfig?.user
          ? `${latestConfig.user.givenName} ${latestConfig.user.familyName}`
          : null,
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
