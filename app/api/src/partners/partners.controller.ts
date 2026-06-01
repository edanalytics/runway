import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient, Tenant } from '@prisma/client';
import {
  PutPartnerConfigDto,
  toGetPartnerConfigDto,
} from '@edanalytics/models';
import { Response } from 'express';
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
  ) {}

  @Authorize('partner-earthmover-bundle.create')
  @Post(':type/:bundleKey')
  async enableBundle() {}

  @Authorize('partner-config.read')
  @Get('config')
  async getConfig(
    @TenantDecorator() tenant: Tenant,
    @Res({ passthrough: true }) res: Response,
  ) {
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: tenant.partnerId },
      select: { crossYearMatchingEnabled: true, modifiedOn: true },
    });
    const eduCredsExist = await this.eduPool.canConnect(tenant.partnerId);
    res.setHeader('x-config-modified-at', partner.modifiedOn.toISOString());
    return toGetPartnerConfigDto({
      crossYearMatchingEnabled: partner.crossYearMatchingEnabled,
      eduCredsExist,
    });
  }

  @Authorize('partner-config.update')
  @Put('config')
  async updateConfig(
    @TenantDecorator() tenant: Tenant,
    @Headers('x-if-config-modified-at') ifModifiedAtHeader: string | undefined,
    @Body() body: PutPartnerConfigDto,
  ) {
    if (body.crossYearMatchingEnabled && !(await this.eduPool.canConnect(tenant.partnerId))) {
      throw new BadRequestException('EDU credentials are not configured for this partner.');
    }

    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: tenant.partnerId },
      select: {
        modifiedOn: true,
        userPartnerModifiedByIdTouser: { select: { givenName: true, familyName: true } },
      },
    });

    // Check-then-write: concurrent requests can both pass before either writes.
    // Acceptable for a low-frequency admin config surface.
    const ifModifiedAt = ifModifiedAtHeader ?? null;
    const currentModifiedAt = partner.modifiedOn.toISOString();
    if (ifModifiedAt !== currentModifiedAt) {
      const lastModifiedBy = partner.userPartnerModifiedByIdTouser;
      throw new ConflictException({
        statusCode: 409,
        message: 'Config has been modified since you loaded it.',
        lastModifiedOn: currentModifiedAt,
        lastModifiedBy: lastModifiedBy
          ? `${lastModifiedBy.givenName} ${lastModifiedBy.familyName}`
          : null,
      });
    }

    await this.prisma.partner.update({
      where: { id: tenant.partnerId },
      data: { crossYearMatchingEnabled: body.crossYearMatchingEnabled },
    });
    return { status: 'ok' };
  }
}
