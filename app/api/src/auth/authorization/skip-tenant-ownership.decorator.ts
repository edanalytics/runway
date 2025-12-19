import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_OWNERSHIP = 'skipTenantOwnership';
export const SkipTenantOwnership = () => SetMetadata(SKIP_TENANT_OWNERSHIP, true);
