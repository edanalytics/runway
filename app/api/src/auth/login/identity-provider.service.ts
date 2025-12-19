import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaClient, OidcConfig, IdentityProvider, Partner } from '@prisma/client';
import { Request as ExpressRequest } from 'express';
import * as jose from 'jose';
import { BaseClient, IdTokenClaims, Strategy } from 'openid-client';
import passport from 'passport';
import { AppConfigService } from '../../config/app-config.service';
import { PRISMA_ANONYMOUS } from '../../database';
import { AuthService } from '../auth.service';
import { initOpenidClient } from './init-openid-client';
import { IPassportSession } from '@edanalytics/models';

/**
 * Identity Provider Service. Today, this is focused on OIDC integrations and there's
 * a lot of OIDC-specific code in here. You could imagine us factoring this out
 * if we someday add SAML support, too.
 */

@Injectable()
export class IdentityProviderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IdentityProviderService.name);
  private readonly idpRegistrations: {
    [k: IdentityProvider['id']]: {
      id: IdentityProvider['id'];
      config: OidcConfig;
      client: BaseClient;
      feHome: string;
    };
  } = {};

  constructor(
    @Inject(PRISMA_ANONYMOUS) private prisma: PrismaClient,
    @Inject(AuthService)
    private authService: AuthService,
    private readonly configService: AppConfigService
  ) {}

  async onApplicationBootstrap() {
    const idps = await this.prisma.identityProvider.findMany({
      include: { oidcConfig: true, partners: true },
    });
    for (const idp of idps) {
      if (idp.oidcConfig && idp.partners.length > 0) {
        if (idp.partners.length > 1 && !idp.oidcConfig.partnerClaim) {
          // We allow the app to boot since the misconfiguration might not impact all IdPs.
          // E.g. if EdGraph is misconfigured, UM users should still be able to get in.
          // However, we do not register a login strategy for this IdP and users will not
          // be able to log in through that IdP.
          this.logger.error(
            `${idp.id} does not have a partner claim but is used by ${idp.partners
              .map((p) => p.id)
              .join(
                ', '
              )}. Users for these partners will not be able to log in until this is fixed.`
          );
        } else {
          await this.registerOidcIdp(
            idp as IdentityProvider & { oidcConfig: OidcConfig; partners: Partner[] }
          );
        }
      }
    }
  }

  idpRegistrationsForOrigin(origin: string) {
    const registrations = Object.values(this.idpRegistrations);
    return registrations.find((reg) => reg.feHome === origin);
  }

  idpRegistrationForId(id: IdentityProvider['id']) {
    return this.idpRegistrations[id];
  }

  passportKey(idpId: IdentityProvider['id']) {
    return `portal-idp-${idpId}`;
  }

  async validateJwt(jwt: string) {
    const body = jose.decodeJwt(jwt);
    const client = Object.values(this.idpRegistrations).find(
      ({ client }) => client.issuer.metadata.issuer === body.iss
    )?.client;
    if (!client || !client.issuer.metadata.jwks_uri) {
      return {
        status: 'TOKEN_ISSUER_NOT_REGISTERED' as const,
      };
    }
    const header = jose.decodeProtectedHeader(jwt);
    const jwks = (await fetch(client.issuer.metadata.jwks_uri).then((res) => res.json())) as {
      keys: { kid: string; alg: string; kty: string; n: string; e: string }[];
    };
    try {
      const requestedJwk = jwks.keys.find((k) => k.kid === header.kid);
      if (!requestedJwk) {
        throw new Error('Requested JWK not found');
      }
      const joseKey = await jose.importJWK(requestedJwk);
      const verifyResult = await jose.jwtVerify(jwt, joseKey);
      return {
        status: 'VALID_TOKEN' as const,
        token: verifyResult,
      };
    } catch (verifyError) {
      return {
        status: 'INVALID_TOKEN' as const,
      };
    }
  }

  private async registerOidcIdp(
    idp: IdentityProvider & { oidcConfig: OidcConfig; partners: Partner[] }
  ): Promise<void> {
    const initClientResult = await initOpenidClient(idp.oidcConfig);

    if (initClientResult.client) {
      this.idpRegistrations[idp.id] = {
        id: idp.id,
        client: initClientResult.client,
        config: idp.oidcConfig,
        feHome: idp.feHome,
      };

      const strategy = new Strategy<IPassportSession | false>(
        {
          client: initClientResult.client,
          params: {
            redirect_uri: `${this.configService.get('MY_URL')}/api/auth/callback/${idp.id}`,
            scope: idp.oidcConfig.scopes ?? 'openid email profile',
          },
          passReqToCallback: true,
          usePKCE: idp.oidcConfig.usePkce ?? false,
        },
        async (request, tokenset, userinfo, done) => {
          try {
            // IdPs might send data in the id token or userinfo. We combine the two with a preference for userinfo claims.
            const claims = { ...tokenset.claims(), ...userinfo };
            if (idp.oidcConfig.embeddedClaimsClaim) {
              // EA app launcher embeds extra claims in a JSON string
              try {
                const claimString = this.getClaimValue(
                  claims,
                  idp.oidcConfig.embeddedClaimsClaim,
                  'string'
                );
                const embeddedClaims = JSON.parse(claimString);

                if (
                  typeof embeddedClaims !== 'object' ||
                  embeddedClaims === null ||
                  Array.isArray(embeddedClaims)
                ) {
                  throw new Error(`Invalid embedded claims: ${claimString}`);
                }

                Object.assign(claims, embeddedClaims);
              } catch (e) {
                this.logger.error('Failed to parse embedded claims', e);
                throw new Error('Failed to parse embedded claims');
              }
            }
            const { requireRole, rolesClaim, requiredRoles } = idp.oidcConfig;
            if (requireRole) {
              if (!rolesClaim || !requiredRoles.length) {
                throw new Error(
                  'Improper OIDC configuration. Role is required but role claim and/or required roles not configured.'
                );
              }

              const rolesFromClaim = this.getClaimValue(claims, rolesClaim);
              if (!rolesFromClaim || !this.hasARequiredRole(rolesFromClaim, requiredRoles)) {
                throw new Error('User does not have required role');
              }
            }

            let partnerId: string | undefined;
            if (idp.oidcConfig.partnerClaim) {
              // If configured to have a partner claim, enforce it: must be present and must match a partner that uses this IdP
              const partnerFromClaim = this.getClaimValue(
                claims,
                idp.oidcConfig.partnerClaim,
                'string'
              );

              // Insure the token includes a partner claim and that it matches one of the partners associated with the IdP.
              if (partnerFromClaim && idp.partners.some((p) => p.id === partnerFromClaim)) {
                partnerId = partnerFromClaim;
              } else {
                this.logger.error(
                  `User does not have required partner. Partner from claim: ${partnerFromClaim}. Partner from IdP registration: ${idp.partners
                    .map((p) => p.id)
                    .join(', ')}`
                );
                throw new Error('User does not have required partner');
              }
            } else if (idp.partners.length === 1) {
              // No partner claim, but IdP used by only one partner (e.g. EdGraph)
              partnerId = idp.partners[0].id;
            } else {
              // On registering IdPs, we check that any multi-partner IdPs have a partner claim, so
              // this is just a safegaurd / sanity check / insurance against changes to the registration code.
              this.logger.error(
                `${idp.id} does not have a partner claim but is used by ${idp.partners
                  .map((p) => p.id)
                  .join(', ')}.`
              );
              throw new Error(
                'Multi-partner IdP must have a partner claim. Add a partner claim to the OIDC config or remove a partner from the IdP registration.'
              );
            }

            if (!partnerId) {
              // sanity check -- should not be able to pass through the above without setting partnerId
              this.logger.error(`No partnerId found for ${idp.id}`);
              throw new Error('No partnerId found for IdP');
            }

            const { user, tenant } = await this.authService.findOrCreateUserAndTenantForIdp(
              {
                email: this.getClaimValue(claims, 'email', false) ?? null,
                givenName: this.getClaimValue(claims, 'given_name'),
                familyName: this.getClaimValue(claims, 'family_name'),
                externalUserId: this.getClaimValue(claims, idp.oidcConfig.userIdClaim, 'string'),
              },
              this.getClaimValue(claims, idp.oidcConfig.tenantCodeClaim, 'string'),
              idp,
              partnerId
            );

            return done(null, {
              user,
              tenant,
              idpSessionId: (claims.sid as string) ?? null, // used to look up session for OIDC backchannel logout
              idToken: tokenset.id_token ?? null,
            });
          } catch (err) {
            // Log error so we can troubleshoot config but pass null to `done`
            // so this presents to the user as a failed login. We don't want to
            // expose auth config issues.
            this.logger.error(err);
            (request as ExpressRequest).session.destroy((err) => {
              err && this.logger.error('Error destroying session on failed login', err);
            });
            return done(null, false);
          }
        }
      );
      passport.use(this.passportKey(idp.id), strategy);
      this.logger.verbose(`Registered ${idp.id}`);
    } else {
      this.logger.warn(`Failed to contact issuer for ${idp.id}`);
    }
  }

  private hasARequiredRole(roleOrRoles: unknown, requiredRoles: string[]): boolean {
    if (Array.isArray(roleOrRoles) && roleOrRoles.every((role) => typeof role === 'string')) {
      return roleOrRoles.some((role) => requiredRoles.includes(role));
    } else if (typeof roleOrRoles === 'string') {
      return requiredRoles.includes(roleOrRoles);
    } else {
      return false;
    }
  }

  private getClaimValue<K extends keyof IdTokenClaims>(
    userinfo: IdTokenClaims,
    claimKey: K,
    required?: true
  ): NonNullable<IdTokenClaims[K]>;
  private getClaimValue<K extends keyof IdTokenClaims>(
    userinfo: IdTokenClaims,
    claimKey: K,
    required?: false
  ): IdTokenClaims[K] | null;
  private getClaimValue<K extends keyof IdTokenClaims>(
    userinfo: IdTokenClaims,
    claimKey: K,
    required?: 'string'
  ): string;
  private getClaimValue<K extends keyof IdTokenClaims>(
    userinfo: IdTokenClaims,
    claimKey: K,
    required: boolean | 'string'
  ): NonNullable<IdTokenClaims[K]> | IdTokenClaims[K];
  private getClaimValue<K extends keyof IdTokenClaims>(
    userinfo: IdTokenClaims,
    claimKey: K,
    required: boolean | 'string' = true
  ): NonNullable<IdTokenClaims[K]> | IdTokenClaims[K] {
    // check nested claims
    if (typeof claimKey === 'string' && claimKey.includes('.')) {
      const [firstKey, ...restKeys] = claimKey.split('.');
      const nestedKey = restKeys.join('.');
      const nestedClaims = userinfo[firstKey];
      if (typeof nestedClaims === 'object' && nestedClaims !== null) {
        return this.getClaimValue(nestedClaims as IdTokenClaims, nestedKey, required);
      } else {
        if (required) {
          throw new Error(`Claim "${claimKey}" not found in userinfo`);
        } else {
          return null;
        }
      }
    }

    if (
      !(claimKey in userinfo) ||
      userinfo[claimKey] === '' ||
      userinfo[claimKey] === undefined ||
      userinfo[claimKey] === null
    ) {
      if (required) {
        throw new Error(`Claim "${claimKey}" not found in userinfo`);
      } else {
        return null;
      }
    }

    // not a huge fan of how the type checking is handled (and especially the required param)
    // but I do want to have confidence in what's coming through on the claims and not just
    // use any. trying to tuck the type checking away in this function.
    const claimValue = userinfo[claimKey];
    if (required === true && typeof claimValue === undefined) {
      throw new Error(`Claim "${claimKey}" undefined in userinfo`);
    }

    if (required === 'string' && typeof claimValue !== 'string') {
      throw new Error(`Claim "${claimKey}" value is not a string: ${claimValue}`);
    }
    return claimValue;
  }
}
