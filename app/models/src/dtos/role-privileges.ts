import { PrivilegeKey } from './privileges';

export type AppRoles = 'PartnerAdmin' | 'User' | 'SupportUser';

export const rolePrivileges: Record<AppRoles, Set<PrivilegeKey>> = Object.freeze({
  PartnerAdmin: Object.freeze(
    new Set<PrivilegeKey>([
      'partner-earthmover-bundle.read',
      'partner-earthmover-bundle.create',
      'partner-earthmover-bundle.delete',
      'school-year-config.read',
      'school-year-config.update',
      'partner-config.read',
      'partner-config.update',
    ])
  ),
  User: Object.freeze(new Set<PrivilegeKey>(['school-year-config.read'])),
  SupportUser: Object.freeze(
    new Set<PrivilegeKey>(['school-year-config.read', 'job.metatenant.read', 'job.metatenant.update', 'ods-config.metatenant.read'])
  ),
});
