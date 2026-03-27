import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { wait } from '@edanalytics/utils';
import { PrismaClient, OidcConfig, IdentityProvider, Partner } from '@prisma/client';
import { Request as ExpressRequest } from 'express';
import * as jose from 'jose';
import { BaseClient, IdTokenClaims, Strategy } from 'openid-client';
import passport from 'passport';
import pg from 'pg';
import { AppConfigService } from '../../config/app-config.service';
import { PRISMA_ANONYMOUS } from '../../database';
import { AuthService } from '../auth.service';
import { initOpenidClient } from './init-openid-client';
import { IPassportSession, rolePrivileges, AppRoles } from '@edanalytics/models';

/** Lowercase AppRole string → canonical name; derived from `rolePrivileges` at module load. */
const CANONICAL_APP_ROLE_BY_LOWER: ReadonlyMap<string, AppRoles> = new Map(
  (Object.keys(rolePrivileges) as AppRoles[]).map((r) => [r.toLowerCase(), r] as const)
);

/**
 * Identity Provider Service. Manages OIDC identity provider registrations as
 * in-memory Passport strategies (required by Passport's architecture).
 *
 * ## Lifecycle
 *
 * **Boot** — `onApplicationBootstrap` reads all IdPs from the DB and attempts
 * issuer discovery for each (concurrently). IdPs whose issuers respond get a
 * Passport strategy registered immediately. IdPs whose issuers are unreachable
 * are retried in the background with exponential backoff (up to ~14 min total)
 * so retry backoff does not block app startup. The initial discovery attempt
 * for each IdP is still awaited.
 *
 * **Live refresh** — PostgreSQL triggers on `oidc_config`, `identity_provider`,
 * and `partner` fire `NOTIFY idp_config_changed`. A dedicated LISTEN connection
 * (scheduled from `main.ts` after boot) picks these up and re-runs registration.
 * IdPs that are no longer valid (deleted, misconfigured, or failed discovery)
 * are pruned, so the runtime refresh path fails closed.
 *
 * **Abort / supersede** — bootstrap and LISTEN-driven refreshes each get an
 * `AbortController`. When a new notification arrives, the previous controller
 * is aborted, cancelling any in-flight discovery retries so a config fix isn't
 * stuck waiting behind stale retries against a bad issuer URL.
 *
 * Today this is focused on OIDC. You could imagine factoring the protocol-
 * specific code out if we someday add SAML support.
 */

@Injectable()
export class IdentityProviderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IdentityProviderService.name);
  private readonly idpRegistrations: {
    [k: IdentityProvider['id']]: {
      id: IdentityProvider['id'];
      config: OidcConfig;
      client: BaseClient;
      feHome: string;
    };
  } = {};
  private listenerClient: pg.PoolClient | null = null;
  private connecting = false;
  private destroyed = false;
  private refreshAbortController: AbortController | null = null;

  constructor(
    @Inject(PRISMA_ANONYMOUS) private prisma: PrismaClient,
    @Inject(AuthService)
    private authService: AuthService,
    private readonly configService: AppConfigService,
    @Inject('DatabaseService') private pool: pg.Pool
  ) {}

  async onApplicationBootstrap() {
    const controller = new AbortController();
    this.refreshAbortController = controller;
    await this.refreshRegistrations(controller.signal);
  }

  async onModuleDestroy() {
    this.destroyed = true;
    if (this.listenerClient) {
      try {
        await this.listenerClient.query('UNLISTEN idp_config_changed');
        this.listenerClient.release();
      } catch {
        /* ignore during shutdown */
      }
    }
  }

  async refreshRegistrations(signal?: AbortSignal) {
    const idps = await this.prisma.identityProvider.findMany({
      include: { oidcConfig: true, partners: true },
    });

    const validIdpIds = new Set<string>();

    const registrations: Promise<void>[] = [];
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
          registrations.push(
            this.registerOidcIdp(
              idp as IdentityProvider & { oidcConfig: OidcConfig; partners: Partner[] },
              signal
            ).then((registered) => {
              if (registered) validIdpIds.add(idp.id);
            })
          );
        }
      }
    }

    await Promise.allSettled(registrations);

    if (signal?.aborted) return;

    // Remove registrations for IdPs that are no longer valid
    for (const existingId of Object.keys(this.idpRegistrations)) {
      if (!validIdpIds.has(existingId)) {
        passport.unuse(this.passportKey(existingId));
        delete this.idpRegistrations[existingId];
        this.logger.verbose(`Unregistered ${existingId}`);
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

  /**
   * Schedule the LISTEN connection for `idp_config_changed` PostgreSQL
   * notifications. Must be called externally (e.g. from main.ts after
   * app.listen()) rather than from onApplicationBootstrap so that tests
   * don't start a listener — seed operations fire the notification triggers
   * and a listener active during seed teardown/reload can race with the
   * test harness.
   *
   * Also handles reconnection on error — the `connecting` flag ensures only
   * one connection attempt is in flight at a time, and the `destroyed` flag
   * prevents reconnection after shutdown.
   */
  scheduleListener(delaySec = 0): void {
    if (this.connecting || this.destroyed) return;
    this.connecting = true;

    if (this.listenerClient) {
      try {
        this.listenerClient.release(true); // destroy; don't return a broken connection to the pool
      } catch {
        /* ignore */
      }
      this.listenerClient = null;
    }

    const connect = () => {
      if (this.destroyed) {
        this.connecting = false;
        return;
      }
      this.pool
        .connect()
        .then(async (client) => {
          if (this.destroyed) {
            client.release(true);
            return;
          }
          this.listenerClient = client;
          await client.query('LISTEN idp_config_changed');
          client.on('notification', () => this.onNotification());
          client.on('error', (err) => {
            this.logger.error('LISTEN connection error', err);
            this.scheduleListener(5);
          });
          this.connecting = false;
          this.logger.verbose('Listening for idp_config_changed notifications');
        })
        .catch((err) => {
          this.connecting = false;
          this.logger.error('Failed to start LISTEN connection', err);
          if (!this.destroyed) this.scheduleListener(5);
        });
    };

    if (delaySec > 0) {
      setTimeout(connect, delaySec * 1000);
    } else {
      connect();
    }
  }

  private async onNotification(): Promise<void> {
    // Abort any in-flight refresh so it doesn't block or overwrite us
    this.refreshAbortController?.abort();

    const controller = new AbortController();
    this.refreshAbortController = controller;

    this.logger.verbose('Received idp_config_changed, refreshing registrations');
    try {
      await this.refreshRegistrations(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        this.logger.error('Failed to refresh IdP registrations', err);
      }
    }
  }

  private static readonly MAX_RETRIES = 10;
  private static readonly MAX_RETRY_DELAY_SEC = 5 * 60;

  private async registerOidcIdp(
    idp: IdentityProvider & { oidcConfig: OidcConfig; partners: Partner[] },
    signal?: AbortSignal
  ): Promise<boolean> {
    const result = await initOpenidClient(idp.oidcConfig);

    if (signal?.aborted) return false;

    if (result.status === 'SUCCESS') {
      this.applyIdpRegistration(idp, result.client);
      return true;
    }

    this.logger.warn(`Failed to contact issuer for ${idp.id}, retrying in background`);
    this.retryRegistration(idp, signal);
    return false;
  }

  private async retryRegistration(
    idp: IdentityProvider & { oidcConfig: OidcConfig; partners: Partner[] },
    signal?: AbortSignal
  ): Promise<void> {
    let retryDelay = 1;
    for (let retry = 1; retry <= IdentityProviderService.MAX_RETRIES; retry++) {
      if (signal?.aborted) return;

      await wait(retryDelay * 1000);
      if (signal?.aborted) return;

      const result = await initOpenidClient(idp.oidcConfig);
      if (signal?.aborted) return;

      if (result.status === 'SUCCESS') {
        this.logger.log(`Successfully contacted OIDC issuer on retry: ${idp.id}`);
        this.applyIdpRegistration(idp, result.client);
        return;
      }

      retryDelay = Math.min(retryDelay * 2, IdentityProviderService.MAX_RETRY_DELAY_SEC);
      this.logger.warn(`Retry ${retry}/${IdentityProviderService.MAX_RETRIES} failed for ${idp.id}, next attempt in ${retryDelay}s`);
    }
    this.logger.error(`Exhausted retries for ${idp.id}`);
  }

  private applyIdpRegistration(
    idp: IdentityProvider & { oidcConfig: OidcConfig; partners: Partner[] },
    client: BaseClient
  ): void {
    this.idpRegistrations[idp.id] = {
      id: idp.id,
      client,
      config: idp.oidcConfig,
      feHome: idp.feHome,
    };

    const strategy = new Strategy<IPassportSession | false>(
        {
          client,
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

            // Extract and match roles from the claim to populate session roles.
            // This is purely additive — it does not affect login success/failure.
            const matchedRoles = this.extractAppRoles(
              claims,
              idp.oidcConfig.rolesClaim,
              idp.oidcConfig.rolePrefix
            );

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
              roles: matchedRoles,
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

  /**
   * Maps OIDC role claim values to `AppRoles`.
   *
   * When `rolePrefix` is set (per IdP in DB), we match it case-insensitively. Roles without the
   * prefix are ignored. Roles with the prefix have the prefix removed. We use lowercased strings
   * for the match and slice to avoid Unicode case folding issues.
   *
   * The suffix (or full token when there is no prefix) is looked up case-insensitively in
   * `rolePrivileges`.
   *
   * Values that do not map to a known app role are ignored.
   */
  private extractAppRoles(
    claims: IdTokenClaims,
    rolesClaim: string | null,
    rolePrefix: string | null
  ): AppRoles[] {
    if (!rolesClaim) return [];

    const rawRoles = this.getClaimValue(claims, rolesClaim, false);
    if (!rawRoles) return [];

    const rolesArray: string[] = Array.isArray(rawRoles)
      ? rawRoles.filter((r): r is string => typeof r === 'string')
      : typeof rawRoles === 'string'
      ? [rawRoles]
      : [];

    const prefixLower = rolePrefix?.toLowerCase() ?? null;
    const matched = new Set<AppRoles>();
    for (const role of rolesArray) {
      let candidate: string;
      const roleLower = role.toLowerCase();
      if (prefixLower) {
        if (!roleLower.startsWith(prefixLower)) {
          continue;
        }
        candidate = roleLower.slice(prefixLower.length);
      } else {
        candidate = roleLower;
      }
      const canonical = CANONICAL_APP_ROLE_BY_LOWER.get(candidate);
      if (canonical !== undefined) {
        matched.add(canonical);
      }
    }

    return Array.from(matched);
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
