import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, PrismaClient, Tenant } from '@prisma/client';
import {
  PutPartnerConfigDto,
  PutTenantFuzzyOptInDto,
  toGetPartnerConfigDto,
  toGetTenantFuzzyOptInDto,
  toGetTenantFuzzyOptInsDto,
} from '@edanalytics/models';
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
    // so concurrent admin edits can't silently overwrite each other. `update`,
    // not `updateMany`, so an undefined partner id throws rather than widening
    // the update to every partner holding the expected values.
    try {
      await this.prisma.partner.update({
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
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new ConflictException('Partner configuration has changed since you loaded it.');
      }
      throw e;
    }
    return { status: 'ok' };
  }

  @Authorize('partner-config.read')
  @Get('tenant-fuzzy-opt-ins')
  async getTenantFuzzyOptIns(@TenantDecorator() tenant: Tenant) {
    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: tenant.partnerId },
      select: {
        tenant: {
          orderBy: { code: 'asc' },
          select: { code: true, tenantFuzzyOptIn: true },
        },
      },
    });
    return toGetTenantFuzzyOptInsDto({
      tenants: partner.tenant.map(({ code, tenantFuzzyOptIn }) => ({
        tenantCode: code,
        fuzzyOptIn: tenantFuzzyOptIn !== null,
      })),
    });
  }

  @Authorize('partner-config.update')
  @Put('tenant-fuzzy-opt-ins/:tenantCode')
  async updateTenantFuzzyOptIn(
    @TenantDecorator() tenant: Tenant,
    @Param('tenantCode') tenantCode: string,
    @Body() body: PutTenantFuzzyOptInDto
  ) {
    const key = { tenantCode, partnerId: tenant.partnerId };
    const target = await this.prisma.tenant.findUnique({
      where: { code_partnerId: { code: tenantCode, partnerId: tenant.partnerId } },
      select: { tenantFuzzyOptIn: true },
    });
    if (!target) {
      throw new NotFoundException(`Tenant not found: ${tenantCode}`);
    }
    // `delete` on the compound key, not `deleteMany`, so an undefined partner
    // id throws rather than removing this code's opt-in under every partner.
    if (!body.fuzzyOptIn && target.tenantFuzzyOptIn) {
      try {
        await this.prisma.tenantFuzzyOptIn.delete({ where: { tenantCode_partnerId: key } });
      } catch (e) {
        // Guard: a concurrent request already removed it.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')) throw e;
      }
    } else if (body.fuzzyOptIn && !target.tenantFuzzyOptIn) {
      if (!(await this.idrs.verifyAccess(tenant.partnerId))) {
        throw new BadRequestException(
          "Runway could not verify this partner's IDRS access, so the tenant wasn't opted in. Check the partner's IDRS credentials and scopes, or try again if IDRS is unavailable."
        );
      }
      // Guard: skipping a duplicate keeps a concurrent request's row and its creator.
      await this.prisma.tenantFuzzyOptIn.createMany({ data: [key], skipDuplicates: true });
    }
    return toGetTenantFuzzyOptInDto({ tenantCode, fuzzyOptIn: body.fuzzyOptIn });
  }
}
