import { Injectable, Logger } from '@nestjs/common';
import {
  AppConfigService,
  IdrsConnectionInfoError,
  IdrsConnectionInfoErrorCause,
} from 'api/src/config/app-config.service';

/** Per-attempt bound on the OAuth token request. */
export const OAUTH_TIMEOUT_MS = 5000;
/** Upper bound on the jittered backoff between the two OAuth attempts. */
export const OAUTH_RETRY_MAX_BACKOFF_MS = 1000;
/**
 * Reuse threshold, not a minimum token lifetime. A cached token is only handed
 * out while more than this much life remains, and a freshly minted token is
 * only worth caching if it clears the same bar — otherwise the next caller
 * would immediately have to mint another one anyway.
 */
export const TOKEN_REUSE_BUFFER_MS = 10 * 60 * 1000;

export type IdentityServiceCredentials = { token: string; url: string };

export type IdentityServiceErrorCause =
  | IdrsConnectionInfoErrorCause
  | 'oauth_not_configured'
  | 'oauth_rejected'
  | 'oauth_invalid_response'
  | 'oauth_unavailable';

/**
 * Which of the three callback responses a failure maps to.
 * - misconfigured: nothing will change until a human changes something
 * - auth_failed: the authorization server understood us and said no
 * - unavailable: dependency retries are exhausted; retrying later may work
 */
export type IdentityServiceFailureKind = 'misconfigured' | 'auth_failed' | 'unavailable';

export class IdentityServiceTokenError extends Error {
  constructor(
    readonly kind: IdentityServiceFailureKind,
    readonly causeCategory: IdentityServiceErrorCause,
    message: string,
    /** Safe upstream detail only — an AWS error name/request id or OAuth status. */
    readonly upstream?: string
  ) {
    super(message);
    this.name = 'IdentityServiceTokenError';
  }
}

type CacheEntry = { token: string; url: string; expiresAt: number };

/**
 * Mints and caches partner-scoped IDRS access tokens for the just-in-time
 * executor callback.
 *
 * The cache is per app instance and per partner. Horizontally scaled
 * instances each mint their own token and can observe a secret rotation at
 * different times; that was an accepted tradeoff over shared cache
 * infrastructure for the first rollout.
 */
@Injectable()
export class IdentityServiceTokenService {
  private readonly logger = new Logger(IdentityServiceTokenService.name);

  private readonly cache = new Map<string, CacheEntry>();
  /**
   * Simultaneous misses for one partner share a single secret lookup and OAuth
   * retry sequence rather than stampeding Secrets Manager. Keyed by partner so
   * one partner's slow or failing lookup never blocks another's.
   */
  private readonly inFlight = new Map<string, Promise<IdentityServiceCredentials>>();

  constructor(private readonly appConfig: AppConfigService) {}

  async getCredentials(partnerId: string): Promise<IdentityServiceCredentials> {
    const cached = this.cache.get(partnerId);
    if (cached && cached.expiresAt - Date.now() > TOKEN_REUSE_BUFFER_MS) {
      return { token: cached.token, url: cached.url };
    }

    const existing = this.inFlight.get(partnerId);
    if (existing) {
      return existing;
    }

    const pending = this.mint(partnerId).finally(() => {
      // Cleared on failure too, so a transient outage doesn't wedge every
      // later caller onto one rejected promise.
      this.inFlight.delete(partnerId);
    });
    this.inFlight.set(partnerId, pending);
    return pending;
  }

  private async mint(partnerId: string): Promise<IdentityServiceCredentials> {
    const tokenUrl = this.appConfig.idrsOauthTokenUrl();
    if (!tokenUrl) {
      throw new IdentityServiceTokenError(
        'misconfigured',
        'oauth_not_configured',
        'IDRS_OAUTH_TOKEN_URL is not configured'
      );
    }

    let connectionInfo: { clientId: string; clientSecret: string; url: string };
    try {
      connectionInfo = await this.appConfig.getIdrsConnectionInfo(partnerId);
    } catch (err) {
      if (err instanceof IdrsConnectionInfoError) {
        throw new IdentityServiceTokenError(
          err.causeCategory === 'secret_fetch_unavailable' ? 'unavailable' : 'misconfigured',
          err.causeCategory,
          err.message,
          [err.awsErrorName, err.awsRequestId].filter(Boolean).join(' ') || undefined
        );
      }
      throw err;
    }

    const { token, expiresInSeconds } = await this.requestToken(tokenUrl, partnerId, connectionInfo);

    const lifetimeMs = expiresInSeconds === undefined ? undefined : expiresInSeconds * 1000;
    if (lifetimeMs === undefined) {
      // Defensive: production tokens are expected to carry a 24h expires_in.
      this.logger.warn(
        `identity service token: partnerId=${partnerId} stage=oauth cause=missing_expires_in — returning token uncached`
      );
    } else if (lifetimeMs <= TOKEN_REUSE_BUFFER_MS) {
      this.logger.warn(
        `identity service token: partnerId=${partnerId} stage=oauth cause=short_lived_token expiresInSeconds=${expiresInSeconds} — returning token uncached`
      );
    } else {
      // The URL is only refreshed alongside a new token, so a rotated base URL
      // can stay in use until the cached token enters the refresh window.
      this.cache.set(partnerId, {
        token,
        url: connectionInfo.url,
        expiresAt: Date.now() + lifetimeMs,
      });
    }

    return { token, url: connectionInfo.url };
  }

  private async requestToken(
    tokenUrl: string,
    partnerId: string,
    connectionInfo: { clientId: string; clientSecret: string; url: string }
  ): Promise<{ token: string; expiresInSeconds: number | undefined }> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: connectionInfo.clientId,
      client_secret: connectionInfo.clientSecret,
      // The configured IDRS url doubles as the OAuth audience and must be sent
      // exactly as configured.
      audience: connectionInfo.url,
      scope: `student:identity:read partner:${partnerId}`,
    });

    let lastTransientError: IdentityServiceTokenError | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await sleep(Math.random() * OAUTH_RETRY_MAX_BACKOFF_MS);
      }
      try {
        return await this.attemptToken(tokenUrl, body);
      } catch (err) {
        if (!(err instanceof IdentityServiceTokenError) || err.kind !== 'unavailable') {
          // A 4xx that isn't a throttle means the request itself is wrong;
          // repeating it verbatim would only produce the same answer.
          throw err;
        }
        lastTransientError = err;
      }
    }
    throw lastTransientError ?? new Error('unreachable');
  }

  private async attemptToken(
    tokenUrl: string,
    body: URLSearchParams
  ): Promise<{ token: string; expiresInSeconds: number | undefined }> {
    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new IdentityServiceTokenError(
        'unavailable',
        'oauth_unavailable',
        'IDRS token request failed',
        err instanceof Error ? err.name : undefined
      );
    }

    if (!response.ok) {
      const transient = response.status === 429 || response.status >= 500;
      throw new IdentityServiceTokenError(
        transient ? 'unavailable' : 'auth_failed',
        transient ? 'oauth_unavailable' : 'oauth_rejected',
        'IDRS token request was not successful',
        // Status only — an OAuth error body can echo back credentials.
        `status=${response.status}`
      );
    }

    let payload: { access_token?: unknown; expires_in?: unknown };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new IdentityServiceTokenError(
        'auth_failed',
        'oauth_invalid_response',
        'IDRS token response was not JSON'
      );
    }

    const token = payload.access_token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new IdentityServiceTokenError(
        'auth_failed',
        'oauth_invalid_response',
        'IDRS token response had no access_token'
      );
    }

    const rawExpiresIn = payload.expires_in;
    if (rawExpiresIn === undefined || rawExpiresIn === null) {
      return { token, expiresInSeconds: undefined };
    }
    // A non-numeric, zero or negative lifetime means we can't reason about the
    // token at all — that's a broken response, not a short-lived token.
    if (typeof rawExpiresIn !== 'number' || !Number.isFinite(rawExpiresIn) || rawExpiresIn <= 0) {
      throw new IdentityServiceTokenError(
        'auth_failed',
        'oauth_invalid_response',
        'IDRS token response had an invalid expires_in'
      );
    }
    return { token, expiresInSeconds: rawExpiresIn };
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
