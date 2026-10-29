import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient, Tenant } from '@prisma/client';
import { PutPartnerConfigDto, toGetPartnerConfigDto } from '@edanalytics/models';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { Tenant as TenantDecorator } from '../auth/helpers/tenant.decorator';
import { EduSnowflakePoolService } from '../earthbeam/api/edu-snowflake-pool.service';
import { IdrsCredentialsService } from '../idrs/idrs-credentials.service';

@Controller()
@ApiTags('Partners')
export class PartnersController {
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private eduPool: EduSnowflakePoolService,
    private idrs: IdrsCredentialsService
  ) {}

  @Authorize('partner-earthmover-bundle.create')
  @Post(':type/:bundleKey')
  async enableBundle() {}

  @Authorize('partner-config.read')
  @Get('config')
  async getConfig(@TenantDecorator() tenant: Tenant) {
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: tenant.partnerId },
      select: { crossYearMatchingEnabled: true, idMatchingMode: true },
    });
    const canConnectToEdu = await this.eduPool.canConnect(tenant.partnerId);
    return toGetPartnerConfigDto({ ...partner, canConnectToEdu });
  }

  @Authorize('partner-config.update')
  @Put('config')
  async updateConfig(@TenantDecorator() tenant: Tenant, @Body() body: PutPartnerConfigDto) {
    const { expected } = body;
    // Each check runs only when its own setting changes, so an outage of one
    // service doesn't block saving the other setting.
    if (
      body.crossYearMatchingEnabled &&
      !expected.crossYearMatchingEnabled &&
      !(await this.eduPool.canConnect(tenant.partnerId))
    ) {
      throw new BadRequestException('EDU credentials are not configured for this partner.');
    }
    if (
      body.idMatchingMode !== expected.idMatchingMode &&
      body.idMatchingMode !== 'id_based' &&
      !(await this.idrs.verifyAccess(tenant.partnerId))
    ) {
      throw new BadRequestException(
        "Runway could not verify this partner's IDRS access, so nothing was saved. Check the partner's IDRS credentials and scopes, or try again if IDRS is unavailable."
      );
    }
    // Write only if the saved values are still the ones the edit started from,
    // so concurrent admin edits can't silently overwrite each other.
    const { count } = await this.prisma.partner.updateMany({
      where: {
        id: tenant.partnerId,
        crossYearMatchingEnabled: expected.crossYearMatchingEnabled,
        idMatchingMode: expected.idMatchingMode,
      },
      data: {
        crossYearMatchingEnabled: body.crossYearMatchingEnabled,
        idMatchingMode: body.idMatchingMode,
      },
    });
    if (count === 0) {
      throw new ConflictException('Partner configuration has changed since you loaded it.');
    }
    return { status: 'ok' };
  }
}
