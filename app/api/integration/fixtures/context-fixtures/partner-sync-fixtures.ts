import { Partner, Tenant } from '@prisma/client';

export const syncPartner: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'sync-partner',
  name: 'Sync Partner',
  managedBy: 'user_management_sync',
};

export const gonePartner: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'gone-partner',
  name: 'Gone Partner',
  managedBy: 'user_management_sync',
};

export const returningPartner: Pick<Partner, 'id' | 'name' | 'managedBy' | 'deletedOn'> = {
  id: 'returning-partner',
  name: 'Returning Partner',
  managedBy: 'user_management_sync',
  deletedOn: new Date('2024-01-01'),
};

export const doomedPartner: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'doomed-partner',
  name: 'Doomed Partner',
  managedBy: 'user_management_sync',
};

export const syncPartnerOldTenant: Pick<Tenant, 'code' | 'partnerId'> = {
  code: 'old-tenant',
  partnerId: syncPartner.id,
};

export const syncPartnerReturningTenant: Pick<
  Tenant,
  'code' | 'partnerId' | 'deletedOn' | 'isGlobal'
> = {
  code: 'returning-tenant',
  partnerId: syncPartner.id,
  deletedOn: new Date('2024-01-01'),
  isGlobal: true
};

export const syncPartnerReturningTenantWithChangedGlobal: Pick<
  Tenant,
  'code' | 'partnerId' | 'deletedOn' | 'isGlobal'
> = {
  code: 'stale-returning-tenant',
  partnerId: syncPartner.id,
  deletedOn: new Date('2024-01-01'),
  isGlobal: false,
};

export const syncPartnerUpdateableTenant: Pick<
  Tenant,
  'code' | 'partnerId' | 'isGlobal'
> = {
  code: 'updateable-tenant',
  partnerId: syncPartner.id,
  isGlobal: false,
};

export const doomedTenant1: Pick<Tenant, 'code' | 'partnerId' > = {
  code: 'doomed-tenant-1',
  partnerId: doomedPartner.id,
};

export const doomedTenant2: Pick<Tenant, 'code' | 'partnerId' > = {
  code: 'doomed-tenant-2',
  partnerId: doomedPartner.id,
};
