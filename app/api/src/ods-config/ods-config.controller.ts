import {
  PostOdsConfigDto,
  PutOdsConfigDto,
  toGetOdsConfigDto,
  toGetOdsConfigWithSecretDto,
} from '@edanalytics/models';
import {
  BadRequestException,
  Body,
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
import { Tenant } from '../auth/helpers/tenant.decorator';
import { TenantOwnership } from '../auth/authorization/tenant-ownership.guard';
import { SkipTenantOwnership } from '../auth/authorization/skip-tenant-ownership.decorator';

@ApiTags('ODS')
@UseGuards(new TenantOwnership('odsConfig'))
@Controller()
export class OdsConfigController {
  constructor(
    @Inject(PRISMA_APP_USER) private prisma: PrismaClient,
    private odsConfigService: OdsConfigService
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
    const result = await this.odsConfigService.testConnection(createOdsDto);
    if (result.status === 'ERROR') {
      const msg =
        result.type === 'AUTH'
          ? 'Unable to authenticate to ODS with given credentials.'
          : 'ODS connection failed.';
      throw new BadRequestException(msg);
    }

    const newOdsConfig = await this.odsConfigService.create(createOdsDto, tenant, this.prisma);
    return toGetOdsConfigWithSecretDto(newOdsConfig);
  }

  @Put(':odsConfigId')
  async update(
    @Param('odsConfigId', new ParseIntPipe())
    odsConfigId: number,
    @Body() updateOdsDto: PutOdsConfigDto
  ) {
    const result = await this.odsConfigService.testConnection(updateOdsDto);
    if (result.status === 'ERROR') {
      const msg =
        result.type === 'AUTH'
          ? 'Unable to authenticate to ODS with given credentials.'
          : 'ODS connection failed.';
      throw new BadRequestException(msg);
    }

    return toGetOdsConfigWithSecretDto(
      await this.odsConfigService.update(odsConfigId, updateOdsDto, this.prisma)
    );
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

    const result = await this.odsConfigService.testConnection(ods.activeConnection);
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
