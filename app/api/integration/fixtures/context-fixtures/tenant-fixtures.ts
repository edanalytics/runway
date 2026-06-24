import { Tenant } from '@prisma/client';
import { WithoutAudit } from '../utils/created-modified';
import { partnerA, partnerC, partnerX } from './partner-fixtures';

export const tenantA: WithoutAudit<Tenant> = {
  code: 'tenant-a',
  partnerId: partnerA.id,
  isGlobal: true,
};

export const tenantB: WithoutAudit<Tenant> = {
  code: 'tenant-b',
  partnerId: partnerA.id,
  isGlobal: true,
};

export const tenantC: WithoutAudit<Tenant> = {
  code: 'tenant-c',
  partnerId: partnerC.id, // shares idp with partner A
  isGlobal: true,
};

export const tenantX: WithoutAudit<Tenant> = {
  code: 'tenant-x',
  partnerId: partnerX.id,
  isGlobal: true,
};
