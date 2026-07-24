import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { GetSessionDataDto, isDescendant, PrivilegeKey, toGetTenantDto } from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { Request } from 'express';
import { PRISMA_READ_ONLY } from '../../database';
import { SKIP_TENANT_OWNERSHIP } from './skip-tenant-ownership.decorator';
import { ALLOW_METATENANT } from './allow-metatenant.decorator';
import { TENANT_RESOURCE_KEY } from './tenant-resource-key.decorator';

@Injectable()
export class TenantOwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA_READ_ONLY) private readonly prisma: PrismaClient
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipTenantOwnershipCheck = this.reflector.get<boolean>(
      SKIP_TENANT_OWNERSHIP,
      context.getHandler()
    );
    const allowMetatenantPrivilege = this.reflector.get<PrivilegeKey | null>(
      ALLOW_METATENANT,
      context.getHandler()
    );
    if (skipTenantOwnershipCheck) {
      return true;
    }

    const resourceKey = this.reflector.get<keyof Request>(
      TENANT_RESOURCE_KEY,
      context.getClass()
    );

    const request = context.switchToHttp().getRequest<Request>();
    const sessionTenant = request.user.tenant;
    if (!sessionTenant) {
      throw new ForbiddenException('Forbidden'); // if there is no tenant, something is wrong with the session
    }

    // TODO: get some better typing around this
    const resource = request[resourceKey];
    const isExactTenantMatch =
      resource.tenantCode === sessionTenant.code && resource.partnerId === sessionTenant.partnerId;

    if (isExactTenantMatch) {
      return true;
    }
    if (!allowMetatenantPrivilege) {
      throw new ForbiddenException('Forbidden');
    }
    const sessionData = plainToInstance(GetSessionDataDto, request.user);
    if (!sessionData.privileges.has(allowMetatenantPrivilege)) {
      throw new ForbiddenException('Forbidden');
    }

    const resourceTenant = await this.prisma.tenant.findUnique({
      where: { code_partnerId: { code: resource.tenantCode, partnerId: resource.partnerId } },
    });
    if (!resourceTenant) {
      throw new ForbiddenException('Forbidden'); // resource points at a tenant that doesn't exist
    }
    const resourceTenantIsDescendantOfSessionTenant = isDescendant(sessionTenant, resourceTenant);

    if (!resourceTenantIsDescendantOfSessionTenant) {
      throw new ForbiddenException('Forbidden');
    }
    return true;
  }
}
