import { Partner, Tenant } from '@prisma/client';

export const syncPartner: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'sync-partner',
  name: 'Sync Partner',
  managedBy: 'al_sync',
};

export const gonePartner: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'gone-partner',
  name: 'Gone Partner',
  managedBy: 'al_sync',
};

export const returningPartner: Pick<Partner, 'id' | 'name' | 'managedBy' | 'deletedOn'> = {
  id: 'returning-partner',
  name: 'Returning Partner',
  managedBy: 'al_sync',
  deletedOn: new Date('2024-01-01'),
};

export const doomedPartner: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'doomed-partner',
  name: 'Doomed Partner',
  managedBy: 'al_sync',
};

export const syncPartnerOldTenant: Pick<Tenant, 'code' | 'partnerId' | 'managedBy'> = {
  code: 'old-tenant',
  partnerId: syncPartner.id,
  managedBy: 'al_sync',
};

export const syncPartnerReturningTenant: Pick<
  Tenant,
  'code' | 'partnerId' | 'managedBy' | 'deletedOn'
> = {
  code: 'returning-tenant',
  partnerId: syncPartner.id,
  managedBy: 'al_sync',
  deletedOn: new Date('2024-01-01'),
};

export const syncPartnerUpdateableTenant: Pick<
  Tenant,
  'code' | 'partnerId' | 'managedBy' | 'isGlobal'
> = {
  code: 'updateable-tenant',
  partnerId: syncPartner.id,
  managedBy: 'al_sync',
  isGlobal: false,
};

export const doomedTenant1: Pick<Tenant, 'code' | 'partnerId' | 'managedBy'> = {
  code: 'doomed-tenant-1',
  partnerId: doomedPartner.id,
  managedBy: 'al_sync',
};

export const doomedTenant2: Pick<Tenant, 'code' | 'partnerId' | 'managedBy'> = {
  code: 'doomed-tenant-2',
  partnerId: doomedPartner.id,
  managedBy: 'al_sync',
};
