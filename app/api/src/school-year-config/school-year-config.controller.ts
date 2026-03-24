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

const LAST_MODIFIED_HEADER = 'x-last-modified';

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

    if (maxModifiedOn) {
      res.setHeader(LAST_MODIFIED_HEADER, maxModifiedOn.toISOString());
    }

    return toGetSchoolYearConfigDto(schoolYears.map((sy) => {
      const config = sy.schoolYearConfig[0] ?? null;
      return {
        schoolYearId: sy.id,
        startYear: sy.startYear,
        endYear: sy.endYear,
        isEnabled: config?.isEnabled ?? false,
        sendToOds: config?.sendToOds ?? true,
        hasOds: sy.odsConfig.length > 0,
      };
    }));
  }

  @Authorize('school-year-config.update')
  @Put()
  async updateConfig(
    @TenantDecorator() tenant: Tenant,
    @Headers(LAST_MODIFIED_HEADER) lastModifiedHeader: string | undefined,
    @Body(new ParseArrayPipe({ items: PutSchoolYearConfigRowDto })) body: PutSchoolYearConfigRowDto[],
  ) {
    const partnerId = tenant.partnerId;
    const lastModifiedOn = lastModifiedHeader ?? null;

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
    const existingConfigs = await this.prisma.schoolYearConfig.findMany({
      where: { partnerId },
      include: { user: true },
    });

    const currentMaxModifiedOn = existingConfigs.length > 0
      ? existingConfigs.reduce(
          (max, c) => (c.modifiedOn > max ? c.modifiedOn : max),
          existingConfigs[0].modifiedOn,
        )
      : null;

    // Compare timestamps: if client sent null, current must also be null (no rows exist)
    if (lastModifiedOn === null && currentMaxModifiedOn !== null) {
      const lastModifier = existingConfigs.reduce((latest, c) =>
        c.modifiedOn > latest.modifiedOn ? c : latest
      );
      throw new ConflictException({
        statusCode: 409,
        message: 'Config has been modified since you loaded it.',
        lastModifiedOn: currentMaxModifiedOn.toISOString(),
        lastModifiedBy: lastModifier.user
          ? `${lastModifier.user.givenName} ${lastModifier.user.familyName}`
          : null,
      });
    }

    if (lastModifiedOn !== null && currentMaxModifiedOn !== null) {
      const clientTs = new Date(lastModifiedOn).getTime();
      const serverTs = currentMaxModifiedOn.getTime();
      if (clientTs !== serverTs) {
        const lastModifier = existingConfigs.reduce((latest, c) =>
          c.modifiedOn > latest.modifiedOn ? c : latest
        );
        throw new ConflictException({
          statusCode: 409,
          message: 'Config has been modified since you loaded it.',
          lastModifiedOn: currentMaxModifiedOn.toISOString(),
          lastModifiedBy: lastModifier.user
            ? `${lastModifier.user.givenName} ${lastModifier.user.familyName}`
            : null,
        });
      }
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
