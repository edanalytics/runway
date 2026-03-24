import { Body, Controller, ConflictException, Get, Inject, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient, Tenant } from '@prisma/client';
import { PutSchoolYearConfigDto, toGetSchoolYearConfigDto } from '@edanalytics/models';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { Tenant as TenantDecorator } from '../auth/helpers/tenant.decorator';

@ApiTags('SchoolYearConfig')
@Controller()
export class SchoolYearConfigController {
  constructor(@Inject(PRISMA_APP_USER) private prisma: PrismaClient) {}

  @Authorize('school-year-config.read')
  @Get()
  async getConfig(@TenantDecorator() tenant: Tenant) {
    const partnerId = tenant.partnerId;

    const [partner, schoolYears, configs, odsCounts] = await Promise.all([
      this.prisma.partner.findUniqueOrThrow({ where: { id: partnerId } }),
      this.prisma.schoolYear.findMany({ orderBy: { startYear: 'desc' } }),
      this.prisma.schoolYearConfig.findMany({ where: { partnerId } }),
      this.prisma.odsConfig.groupBy({
        by: ['schoolYearId'],
        where: { partnerId, retired: false },
        _count: { schoolYearId: true },
      }),
    ]);

    const configMap = new Map(configs.map((c) => [c.schoolYearId, c]));
    const odsCountMap = new Map(odsCounts.map((o) => [o.schoolYearId, o._count.schoolYearId]));

    const maxModifiedOn = configs.length > 0
      ? configs.reduce((max, c) => (c.modifiedOn > max ? c.modifiedOn : max), configs[0].modifiedOn)
      : null;

    const rows = schoolYears.map((sy) => {
      const config = configMap.get(sy.id);
      return {
        schoolYearId: sy.id,
        startYear: sy.startYear,
        endYear: sy.endYear,
        isEnabled: config?.isEnabled ?? false,
        sendToOds: config?.sendToOds ?? true,
        odsCount: odsCountMap.get(sy.id) ?? 0,
      };
    });

    return toGetSchoolYearConfigDto({
      partnerName: partner.name,
      lastModifiedOn: maxModifiedOn?.toISOString() ?? null,
      rows,
    });
  }

  @Authorize('school-year-config.update')
  @Put()
  async updateConfig(
    @TenantDecorator() tenant: Tenant,
    @Body() body: PutSchoolYearConfigDto,
  ) {
    const partnerId = tenant.partnerId;

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
    if (body.lastModifiedOn === null && currentMaxModifiedOn !== null) {
      const lastModifier = existingConfigs.reduce((latest, c) =>
        c.modifiedOn > latest.modifiedOn ? c : latest
      );
      throw new ConflictException({
        statusCode: 409,
        message: 'Config has been modified since you loaded it.',
        lastModifiedOn: currentMaxModifiedOn,
        lastModifiedBy: lastModifier.user
          ? `${lastModifier.user.givenName} ${lastModifier.user.familyName}`
          : null,
      });
    }

    if (body.lastModifiedOn !== null && currentMaxModifiedOn !== null) {
      const clientTs = new Date(body.lastModifiedOn).getTime();
      const serverTs = currentMaxModifiedOn.getTime();
      if (clientTs !== serverTs) {
        const lastModifier = existingConfigs.reduce((latest, c) =>
          c.modifiedOn > latest.modifiedOn ? c : latest
        );
        throw new ConflictException({
          statusCode: 409,
          message: 'Config has been modified since you loaded it.',
          lastModifiedOn: currentMaxModifiedOn,
          lastModifiedBy: lastModifier.user
            ? `${lastModifier.user.givenName} ${lastModifier.user.familyName}`
            : null,
        });
      }
    }

    // Bulk upsert — audit columns (modified_on, modified_by_id) are set by DB triggers
    await this.prisma.$transaction(
      body.rows.map((row) =>
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
