import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SKIP_TENANT_OWNERSHIP } from './skip-tenant-ownership.decorator';

@Injectable()
export class TenantOwnership implements CanActivate {
  private reflector: Reflector;
  constructor(private readonly resourceKey: keyof Request) {
    this.reflector = new Reflector();
  }

  canActivate(context: ExecutionContext): boolean {
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
    const resource = request[this.resourceKey];
    const sessionTenant = tenant;
    const resourceTenant = resource?.tenant;
    const isSupportUser = request.user.roles?.includes('PartnerAdmin') ?? false;
    const hasAccessToResourceViaGlobalTenantOnly =
      isSupportUser && resourceTenant.isDescendant(sessionTenant);
    //either the session tenant code abd resource tenant code must match exactly, or the resource tenant must be a descendant of the session tenant
    if (
      (!resource ||
        (resource.tenantCode !== tenant.code && !resourceTenant.isDescendant(sessionTenant)) ||
        resource.partnerId !== tenant.partnerId) &&
      !hasAccessToResourceViaGlobalTenantOnly
    ) {
      throw new ForbiddenException('Forbidden');
    }

    return true;
  }
}
