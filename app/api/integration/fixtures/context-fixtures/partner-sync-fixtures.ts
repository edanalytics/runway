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

export const unmanagedDeletedPartner: Pick<Partner, 'id' | 'name' | 'managedBy' | 'deletedOn'> = {
  id: 'unmanaged-deleted-partner',
  name: 'Unmanaged Deleted Partner',
  managedBy: null,
  deletedOn: new Date('2024-01-01'),
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

export const allActionsPartner: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'all-actions-partner',
  name: 'Kitchen Sink Partner',
  managedBy: 'user_management_sync',
};

export const allActionsTenantToDelete: Pick<Tenant, 'code' | 'partnerId'> = {
  code: 'all-actions-to-delete',
  partnerId: allActionsPartner.id,
};

export const allActionsTenantToUndelete: Pick<
  Tenant,
  'code' | 'partnerId' | 'deletedOn' | 'isGlobal'
> = {
  code: 'all-actions-to-undelete',
  partnerId: allActionsPartner.id,
  deletedOn: new Date('2024-01-01'),
  isGlobal: false,
};

export const allActionsTenantToUpdate: Pick<Tenant, 'code' | 'partnerId' | 'isGlobal'> = {
  code: 'all-actions-to-update',
  partnerId: allActionsPartner.id,
  isGlobal: false,
};

export const allActionsTenantUnchanged: Pick<Tenant, 'code' | 'partnerId' | 'isGlobal'> = {
  code: 'all-actions-unchanged',
  partnerId: allActionsPartner.id,
  isGlobal: true,
};

export const concurrentPartnerOne: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'concurrent-partner-one',
  name: 'Concurrent Partner One',
  managedBy: 'user_management_sync',
};

export const concurrentPartnerTwo: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'concurrent-partner-two',
  name: 'Concurrent Partner Two',
  managedBy: 'user_management_sync',
};

export const partialFailurePartnerOk: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'partial-failure-partner-ok',
  name: 'Partial Failure Partner Ok',
  managedBy: 'user_management_sync',
};

export const partialFailurePartnerFail: Pick<Partner, 'id' | 'name' | 'managedBy'> = {
  id: 'partial-failure-partner-fail',
  name: 'Partial Failure Partner Fail',
  managedBy: 'user_management_sync',
};

export const partialFailureExistingTenant: Pick<Tenant, 'code' | 'partnerId'> = {
  code: 'partial-failure-existing-tenant',
  partnerId: partialFailurePartnerFail.id,
};
