import {
  PostOdsConfigDto,
  PutOdsConfigDto,
  toGetOdsConfigDto,
  toGetOdsConfigWithSecretDto,
} from '@edanalytics/models';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import type { PrismaClient, Tenant as TTenant } from '@prisma/client';
import { PRISMA_APP_USER } from '../database';
import { throwNotFound } from '../utils';
import { OdsConfigService } from './ods-config.service';
import { EdfiService } from '../edfi/edfi.service';
import { Tenant } from '../auth/helpers/tenant.decorator';
import { TenantOwnership } from '../auth/authorization/tenant-ownership.guard';
import { SkipTenantOwnership } from '../auth/authorization/skip-tenant-ownership.decorator';

@ApiTags('ODS')
@UseGuards(new TenantOwnership('odsConfig'))
@Controller()
export class OdsConfigController {
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private odsConfigService: OdsConfigService,
    private edfiService: EdfiService
  ) {}

  @Get()
  @SkipTenantOwnership()
  async findAll(@Tenant() tenant: TTenant) {
    return toGetOdsConfigDto(await this.odsConfigService.findAll(tenant));
  }

  @Get(':odsConfigId')
  async findOne(
    @Param('odsConfigId', new ParseIntPipe())
    odsConfigId: number,
    @Req() req: Request
  ) {
    const odsConfig = req.odsConfig;
    if (!odsConfig) {
      return throwNotFound(`ODS not found: ${odsConfigId}`);
    }

    return toGetOdsConfigWithSecretDto(odsConfig);
  }

  @Post()
  @SkipTenantOwnership()
  async create(@Body() createOdsDto: PostOdsConfigDto, @Tenant() tenant: TTenant) {
    // TODO(PR 3): validate schoolYearId against school_year_config.
    // For now, invalid school years will hit the FK constraint on ods_config.school_year_id.
    const connectionTest = await this.edfiService.testConnection(createOdsDto);
    if (connectionTest.status === 'ERROR') {
      throw new BadRequestException('Unable to authenticate to ODS with given credentials.');
    }

    const result = await this.odsConfigService.create(createOdsDto, tenant, this.prisma);
    if (result.status === 'ERROR') {
      throw new ConflictException('An active ODS configuration already exists for this tenant and school year.');
    }
    return toGetOdsConfigWithSecretDto(result.data);
  }

  @Put(':odsConfigId')
  async update(
    @Param('odsConfigId', new ParseIntPipe())
    odsConfigId: number,
    @Body() updateOdsDto: PutOdsConfigDto
  ) {
    const connectionTest = await this.edfiService.testConnection(updateOdsDto);
    if (connectionTest.status === 'ERROR') {
      throw new BadRequestException('Unable to authenticate to ODS with given credentials.');
    }

    const result = await this.odsConfigService.update(odsConfigId, updateOdsDto, this.prisma);
    if (result.status === 'ERROR') {
      throw new ConflictException('An active ODS configuration already exists for this tenant and school year.');
    }
    return toGetOdsConfigWithSecretDto(result.data);
  }

  @Post(':odsConfigId/test-connection')
  async testConnection(
    @Param('odsConfigId', new ParseIntPipe())
    odsConfigId: number,
    @Req() req: Request
  ) {
    const ods = req.odsConfig;
    if (!ods) {
      return throwNotFound(`ODS not found: ${odsConfigId}`);
    }

    const result = await this.edfiService.testConnection(ods.activeConnection);
    const updatedConfig = await this.odsConfigService.updateConnectionStatus(
      odsConfigId,
      result.status === 'SUCCESS' ? 'success' : 'error', // TODO: clean this up, ugly
      this.prisma
    );

    return toGetOdsConfigDto(updatedConfig);
  }

  @Delete(':odsConfigId')
  async remove(
    @Param('odsConfigId', new ParseIntPipe())
    odsConfigId: number
  ) {
    await this.odsConfigService.retire(odsConfigId, this.prisma);
  }
}
