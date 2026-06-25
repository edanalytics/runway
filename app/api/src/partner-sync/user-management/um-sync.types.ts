export type UserManagementTenant = {
  partnerCode: string;
  tenantCode: string;
  displayName: string;
  isEnabled: boolean;
  isGlobal: boolean;
};

export type UserManagementPartner = {
  partnerCode: string;
};

export type TenantUpsert = {
  code: string;
  partnerId: string;
  isGlobal: boolean;
};
