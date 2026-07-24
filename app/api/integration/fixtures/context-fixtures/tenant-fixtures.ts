import { Tenant } from '@prisma/client';
import { WithoutAudit } from '../utils/created-modified';
import { partnerA, partnerC, partnerX } from './partner-fixtures';

export const tenantA: WithoutAudit<Tenant> = {
  code: 'tenant-a',
  partnerId: partnerA.id,
  isGlobal: false,
  deletedOn: null,
};

export const tenantB: WithoutAudit<Tenant> = {
  code: 'tenant-b',
  partnerId: partnerA.id,
  isGlobal: false,
  deletedOn: null,
};

// Global tenant for partner A — support users (PartnerAdmin) logged in here
// get access to any non-global tenant under partner A (tenantA, tenantB).
export const tenantAGlobal: WithoutAudit<Tenant> = {
  code: 'tenant-a-global',
  partnerId: partnerA.id,
  isGlobal: true,
  deletedOn: null,
};

export const tenantC: WithoutAudit<Tenant> = {
  code: 'tenant-c',
  partnerId: partnerC.id, // shares idp with partner A
  isGlobal: false,
  deletedOn: null,
};

export const tenantX: WithoutAudit<Tenant> = {
  code: 'tenant-x',
  partnerId: partnerX.id,
  isGlobal: false,
  deletedOn: null,
};
