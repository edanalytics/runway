import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Inject,
  Logger,
  Post,
  Put,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient, Tenant } from '@prisma/client';
import {
  PutPartnerConfigDto,
  PutPartnerIdMatchingModeDto,
  toGetPartnerConfigDto,
  toGetPartnerIdMatchingModeDto,
} from '@edanalytics/models';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { Tenant as TenantDecorator } from '../auth/helpers/tenant.decorator';
import { EduSnowflakePoolService } from '../earthbeam/api/edu-snowflake-pool.service';
import { IdrsReadinessService } from '../idrs/idrs-readiness.service';

@Controller()
@ApiTags('Partners')
export class PartnersController {
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private eduPool: EduSnowflakePoolService,
    private readonly idrsReadiness: IdrsReadinessService
  ) {}

  @Authorize('partner-id-matching-mode.read')
  @Get('id-matching-mode')
  async getMatchingMode(@TenantDecorator() tenant: Tenant) {
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: tenant.partnerId },
      select: { idMatchingMode: true },
    });
    return toGetPartnerIdMatchingModeDto(partner);
  }

  @Authorize('partner-id-matching-mode.update')
  @Put('id-matching-mode')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateMatchingMode(
    @TenantDecorator() tenant: Tenant,
    @Body() body: PutPartnerIdMatchingModeDto
  ) {
    const started = Date.now();
    if (body.idMatchingMode !== 'id_based') {
      const result = await this.idrsReadiness.checkPartner(tenant.partnerId);
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
    }
    try {
      const partner = await this.prisma.partner.update({
        where: { id: tenant.partnerId },
        data: { idMatchingMode: body.idMatchingMode },
        select: { idMatchingMode: true },
      });
      return toGetPartnerIdMatchingModeDto(partner);
    } catch {
      Logger.error(
        `Matching-mode update failed: partnerId=${tenant.partnerId}`,
        'PartnersController'
      );
      throw new InternalServerErrorException();
    }
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
