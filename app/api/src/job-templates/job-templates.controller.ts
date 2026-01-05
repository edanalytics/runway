import { Controller, Get, Inject, Param, ParseEnumPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EarthmoverBundleTypes, toGetJobTemplateDto } from '@edanalytics/models';
import { EarthbeamBundlesService } from '../earthbeam/earthbeam-bundles.service';
import { Tenant } from '../auth/helpers/tenant.decorator';
import type { PrismaClient, Tenant as TTenant } from '@prisma/client';
import { PRISMA_APP_USER } from '../database';
import { Authorize } from '../auth/helpers/authorize.decorator';

@Controller()
@ApiTags('JobTemplates')
export class JobsTemplatesController {
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private earthbeamService: EarthbeamBundlesService
  ) {}

  @Get(':type')
  async findAllByType(
    @Param('type', new ParseEnumPipe(EarthmoverBundleTypes)) type: EarthmoverBundleTypes,
    @Tenant() tenant: TTenant
  ) {
    const bundles = await this.earthbeamService.getBundles(type);
    const enabledBundles = await this.prisma.partnerEarthmoverBundle.findMany({
      where: {
        partnerId: tenant.partnerId,
      },
    });

    const allowedKeys = enabledBundles.map((bundle) => bundle.earthmoverBundleKey);
    const allowedBundles = bundles.filter((bundle) => allowedKeys.includes(bundle.path)); // path is the only unique identifier for a bundle currently and should be stable. Bundle repo might someday be enhanced with IDs, but not there yet
    return toGetJobTemplateDto(allowedBundles);
  }
  //TODO: move to partner controller
  @Authorize('partner-earthmover-bundle.create')
  @Post(':type/:bundleKey')
  async enableBundle() {}
}
