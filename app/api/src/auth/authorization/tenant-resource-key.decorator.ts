import { SetMetadata } from '@nestjs/common';
import { Request } from 'express';

export const TENANT_RESOURCE_KEY = 'tenantResourceKey';
export const TenantResourceKey = (key: keyof Request) => SetMetadata(TENANT_RESOURCE_KEY, key);
