import { PrivilegeKey } from './privileges';

export type AppRoles = 'PartnerAdmin' | 'User';

export const rolePrivileges: Record<AppRoles, Set<PrivilegeKey>> = Object.freeze({
  PartnerAdmin: Object.freeze(
    new Set<PrivilegeKey>([
      'partner-earthmover-bundle.read',
      'partner-earthmover-bundle.create',
      'partner-earthmover-bundle.delete',
      'school-year-config.read',
      'school-year-config.update',
    ])
  ),
  User: Object.freeze(new Set<PrivilegeKey>([])),
});
