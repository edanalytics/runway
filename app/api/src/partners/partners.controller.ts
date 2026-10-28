import { PartnerMatchingModeService } from './partner-matching-mode.service';
import { BadRequestException, Body, Controller, Get, HttpException, Inject, Logger, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient, Tenant } from '@prisma/client';
import { PutPartnerConfigDto, PutPartnerIdMatchingModeDto, toGetPartnerConfigDto } from '@edanalytics/models';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { Tenant as TenantDecorator } from '../auth/helpers/tenant.decorator';
import { EduSnowflakePoolService } from '../earthbeam/api/edu-snowflake-pool.service';

@Controller()
@ApiTags('Partners')
export class PartnersController {
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private eduPool: EduSnowflakePoolService,
    private matchingMode: PartnerMatchingModeService
  ) {}

  @Authorize('partner-id-matching-mode.update')
  @Put('id-matching-mode')
  async updateMatchingMode(
    @TenantDecorator() tenant: Tenant,
    @Body() body: PutPartnerIdMatchingModeDto
  ) {
    const started = Date.now();
    const result = await this.matchingMode.update(tenant.partnerId, body.idMatchingMode);
    if (result.status === 'ERROR') {
      Logger.warn(
        `IDRS enablement: partnerId=${tenant.partnerId} elapsedMs=${Date.now() - started} ${
          result.cause
        }`,
        'PartnersController'
      );
      const statusCode = result.code === 'idrs_not_ready' ? 422 : 503;
      throw new HttpException(
        {
          statusCode,
          code: result.code,
          message:
            statusCode === 422
              ? 'Runway could not enable this mode. Check the IDRS credentials and required permissions for this partner, then try again.'
              : 'Runway could not verify IDRS access right now. Please try again later.',
        },
        statusCode
      );
    }
    return result.data;
  }

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
    const canConnectToEdu = await this.eduPool.canConnect(tenant.partnerId);
    return toGetPartnerConfigDto({
      crossYearMatchingEnabled: partner.crossYearMatchingEnabled,
      canConnectToEdu,
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
