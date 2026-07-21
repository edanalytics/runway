import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { toGetTenantDto } from '@edanalytics/models';
import { Request } from 'express';
import { PRISMA_READ_ONLY } from '../../database';
import { SKIP_TENANT_OWNERSHIP } from './skip-tenant-ownership.decorator';

export function makeTenantOwnershipGuard(resourceKey: keyof Request) {
  @Injectable()
  class TenantOwnershipGuard implements CanActivate {
    constructor(
      private readonly reflector: Reflector,
      @Inject(PRISMA_READ_ONLY) private readonly prisma: PrismaClient
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const skipTenantOwnershipCheck = this.reflector.get<boolean>(
        SKIP_TENANT_OWNERSHIP,
        context.getHandler()
      );

      if (skipTenantOwnershipCheck) {
        return true;
      }

      const request = context.switchToHttp().getRequest<Request>();
      const tenant = request.user.tenant;
      if (!tenant) {
        throw new ForbiddenException('Forbidden'); // if there is no tenant, something is wrong with the session
      }

      // TODO: get some better typing around this
      const resource = request[resourceKey];
      const sessionTenant = toGetTenantDto(tenant);
      if (!resource) {
        throw new ForbiddenException('Forbidden');
      }

      const resourceTenantRow = await this.prisma.tenant.findUnique({
        where: { code_partnerId: { code: resource.tenantCode, partnerId: resource.partnerId } },
      });
      if (!resourceTenantRow) {
        throw new ForbiddenException('Forbidden'); // resource points at a tenant that doesn't exist
      }
      const resourceTenant = toGetTenantDto(resourceTenantRow);
      const isSupportUser = request.user.roles?.includes('SupportUser') ?? false;
      const hasAccessToJobViaGlobalTenantOnly =
        isSupportUser && resourceTenant.isDescendant(sessionTenant) && resourceKey === 'job';

      // either the session tenant code and resource tenant code must match exactly, or the
      // resource tenant must be a descendant of the session tenant AND the user must be a support user
      const isExactTenantMatch =
        resource.tenantCode === tenant.code && resource.partnerId === tenant.partnerId;
      if (!isExactTenantMatch && !hasAccessToJobViaGlobalTenantOnly) {
        throw new ForbiddenException('Forbidden');
      }

      return true;
    }
  }

  return TenantOwnershipGuard;
}
