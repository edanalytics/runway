export type AlTenant = {
  partnerCode: string;
  tenantCode: string;
  displayName: string;
  isEnabled: boolean;
  isGlobal: boolean;
};

export type AlPartner = {
  partnerCode: string;
};
export { SyncManagers, SyncManager } from '@edanalytics/models';
