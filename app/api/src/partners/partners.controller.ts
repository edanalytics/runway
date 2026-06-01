import { BadRequestException, Body, Controller, Get, Inject, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient, Tenant } from '@prisma/client';
import { PutPartnerConfigDto, toGetPartnerConfigDto } from '@edanalytics/models';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { Tenant as TenantDecorator } from '../auth/helpers/tenant.decorator';
import { EduSnowflakePoolService } from '../earthbeam/api/edu-snowflake-pool.service';

@Controller()
@ApiTags('Partners')
export class PartnersController {
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private eduPool: EduSnowflakePoolService
  ) {}

  @Authorize('partner-earthmover-bundle.create')
  @Post(':type/:bundleKey')
  async enableBundle() {}

  @Authorize('partner-config.read')
  @Get('config')
  async getConfig(@TenantDecorator() tenant: Tenant) {
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: tenant.partnerId },
      select: { crossYearMatchingEnabled: true },
    });
    const eduCredsExist = await this.eduPool.canConnect(tenant.partnerId);
    return toGetPartnerConfigDto({
      crossYearMatchingEnabled: partner.crossYearMatchingEnabled,
      eduCredsExist,
    });
  }

  // TODO: add an optimistic-concurrency / stale-write check before this
  // section grows beyond the single cross-year toggle. With one boolean a
  // last-write-wins clobber is harmless, but once multiple settings share this
  // endpoint, concurrent admin edits could silently overwrite each other.
  @Authorize('partner-config.update')
  @Put('config')
  async updateConfig(@TenantDecorator() tenant: Tenant, @Body() body: PutPartnerConfigDto) {
    if (body.crossYearMatchingEnabled && !(await this.eduPool.canConnect(tenant.partnerId))) {
      throw new BadRequestException('EDU credentials are not configured for this partner.');
    }
    await this.prisma.partner.update({
      where: { id: tenant.partnerId },
      data: { crossYearMatchingEnabled: body.crossYearMatchingEnabled },
    });
    return { status: 'ok' };
  }
}
