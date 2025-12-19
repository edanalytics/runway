import { IdentityProvider, OidcConfig } from '@prisma/client';
import { WithoutAudit } from '../utils/created-modified';

export type IdpFixture = WithoutAudit<IdentityProvider> & { oidcConfig: WithoutAudit<OidcConfig> };

// Configured to be like UM, with a partner claim and embedded claims,
// eventually usable by multiple partners
export const oidcConfigA: WithoutAudit<OidcConfig> = {
  id: 'oidc-config-a',
  issuer: 'http://idp-a',
  clientId: 'client-a',
  clientSecret: 'secret-a',
  userIdClaim: 'user.email',
  tenantCodeClaim: 'session.tenantCode',
  usePkce: true,
  scopes: 'openid profile email',
  requireRole: true,
  rolesClaim: 'session.roles',
  requiredRoles: ['runway.test.user', 'runway.test.admin'],
  embeddedClaimsClaim: 'context',
  partnerClaim: 'session.partnerCode',
};

export const idpA: IdpFixture = {
  id: 'idp-a',
  feHome: 'https://a.runwayloader.org',
  oidcConfigId: oidcConfigA.id,
  oidcConfig: oidcConfigA,
};

// Configured to be like EdGraph, with no partner claim
// and also no embedded claims, usable only by a single partner
export const oidcConfigX: WithoutAudit<OidcConfig> = {
  id: 'oidc-config-x',
  issuer: 'http://idp-x',
  clientId: 'client-x',
  clientSecret: 'secret-x',
  userIdClaim: 'username',
  tenantCodeClaim: 'tenant',
  usePkce: true,
  scopes: 'openid profile email',
  requireRole: true,
  rolesClaim: 'roles',
  requiredRoles: ['Runway.User'],
  embeddedClaimsClaim: null, // like EdGraph
  partnerClaim: null,
};

export const idpX: IdpFixture = {
  id: 'idp-x',
  feHome: 'https://x.runwayloader.org',
  oidcConfigId: oidcConfigX.id,
  oidcConfig: oidcConfigX,
};
