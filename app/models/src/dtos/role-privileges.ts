import { PrivilegeKey } from './privileges';

export type AppRoles = 'PartnerAdmin';

export const rolePrivileges: Record<AppRoles, Set<PrivilegeKey>> = Object.freeze({
  PartnerAdmin: Object.freeze(
    new Set<PrivilegeKey>([
      'partner-earthmover-bundle.read',
      'partner-earthmover-bundle.create',
      'partner-earthmover-bundle.delete',
    ])
  ),
});
