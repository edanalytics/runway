export type AlChildTenant = {
  tenantCode: string;
};

export type AlTenant = {
  partnerCode: string;
  tenantCode: string;
  displayName: string;
  isEnabled: boolean;
  isGlobal: boolean;
  children: AlChildTenant[] | null;
};

export type AlPartner = {
  partnerCode: string;
};
