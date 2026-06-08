import { Partner, Tenant } from '@prisma/client';

export const syncPartner: Pick<Partner, 'id' | 'name' | 'syncManaged'> = {
  id: 'sync-partner',
  name: 'Sync Partner',
  syncManaged: true,
};

export const gonePartner: Pick<Partner, 'id' | 'name' | 'syncManaged'> = {
  id: 'gone-partner',
  name: 'Gone Partner',
  syncManaged: true,
};

export const returningPartner: Pick<Partner, 'id' | 'name' | 'syncManaged' | 'deletedOn'> = {
  id: 'returning-partner',
  name: 'Returning Partner',
  syncManaged: true,
  deletedOn: new Date('2024-01-01'),
};

export const doomedPartner: Pick<Partner, 'id' | 'name' | 'syncManaged'> = {
  id: 'doomed-partner',
  name: 'Doomed Partner',
  syncManaged: true,
};

export const syncPartnerOldTenant: Pick<Tenant, 'code' | 'partnerId' | 'syncManaged'> = {
  code: 'old-tenant',
  partnerId: syncPartner.id,
  syncManaged: true,
};

export const syncPartnerReturningTenant: Pick<
  Tenant,
  'code' | 'partnerId' | 'syncManaged' | 'deletedOn'
> = {
  code: 'returning-tenant',
  partnerId: syncPartner.id,
  syncManaged: true,
  deletedOn: new Date('2024-01-01'),
};

export const syncPartnerUpdateableTenant: Pick<
  Tenant,
  'code' | 'partnerId' | 'syncManaged' | 'isGlobal' | 'children'
> = {
  code: 'updateable-tenant',
  partnerId: syncPartner.id,
  syncManaged: true,
  isGlobal: false,
  children: ['old-child'],
};

export const doomedTenant1: Pick<Tenant, 'code' | 'partnerId' | 'syncManaged'> = {
  code: 'doomed-tenant-1',
  partnerId: doomedPartner.id,
  syncManaged: true,
};

export const doomedTenant2: Pick<Tenant, 'code' | 'partnerId' | 'syncManaged'> = {
  code: 'doomed-tenant-2',
  partnerId: doomedPartner.id,
  syncManaged: true,
};
