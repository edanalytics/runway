import { toGetSchoolYearDto, toGetSchoolYearWithConfigDto } from '@edanalytics/models';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient, Tenant } from '@prisma/client';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { Tenant as TenantDecorator } from '../auth/helpers/tenant.decorator';
import { SkipTenantOwnership } from '../auth/authorization/skip-tenant-ownership.decorator';

@ApiTags('SchoolYear')
@Controller()
export class SchoolYearsController {
  constructor(@Inject(PRISMA_APP_USER) private prisma: PrismaClient) {}

  @Get()
  async findAll() {
    // Currently, just returns the school years used throughout the app.
    // If we someday do tenant or partner-specific years, this could be
    // modified to retrieve those based on the session context.
    // return toGetBigThingyDto(await this.prisma.bigThingy.findMany());
    return toGetSchoolYearDto(
      await this.prisma.schoolYear.findMany({ orderBy: { startYear: 'desc' } })
    );
  }

  @Authorize('school-year-config.read')
  @SkipTenantOwnership()
  @Get('config')
  async getSchoolYearsWithConfig(@TenantDecorator() tenant: Tenant) {
    const schoolYears = await this.prisma.schoolYear.findMany({
      orderBy: { startYear: 'desc' },
      include: {
        schoolYearConfig: {
          where: { partnerId: tenant.partnerId },
        },
        odsConfig: {
          where: { tenantCode: tenant.code, partnerId: tenant.partnerId, retired: false },
          select: { id: true },
        },
      },
    });

    return toGetSchoolYearWithConfigDto(
      schoolYears.map((sy) => {
        const config = sy.schoolYearConfig[0] ?? null;
        return {
          schoolYearId: sy.id,
          startYear: sy.startYear,
          endYear: sy.endYear,
          isEnabled: config?.isEnabled ?? false,
          sendToOds: config?.sendToOds ?? true,
          hasOds: sy.odsConfig.length > 0,
        };
      })
    );
  }
}
