import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from 'api/src/config/app-config.service';

/**
 * Reuse threshold, not a minimum token lifetime: a token is only served — or
 * worth caching — while more than this much life remains.
 */
export const TOKEN_REUSE_BUFFER_MS = 10 * 60 * 1000;

export type IdrsCredentials = { token: string; url: string };

export type IdrsReadinessErrorCode = 'idrs_not_ready' | 'identity_service_unavailable';

/** A classified credential failure with a diagnostic safe for application logs. */
export class IdrsCredentialsError extends Error {
  constructor(message: string, readonly code: IdrsReadinessErrorCode) {
    super(message);
  }
}

type CacheEntry = { token: string; expiresAt: number };

/**
 * Resolves what's needed to reach IDRS on a partner's behalf, for the
 * Executor's identity-service callback and for match review's search: the
 * deployment's IDRS base url and an access token minted with that partner's
 * own OAuth client. Tokens are cached per app instance and per partner, so
 * scaled instances each mint their own and observe a credential rotation at
 * different times — an accepted tradeoff over shared cache infrastructure.
 */
@Injectable()
export class IdrsCredentialsService {
  private readonly logger = new Logger(IdrsCredentialsService.name);

  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly appConfig: AppConfigService) {}

  async getCredentials(
    partnerId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<IdrsCredentials> {
    const url = this.appConfig.idrsUrl();
    if (!url) {
      throw new IdrsCredentialsError('IDRS_URL is not configured or not https', 'idrs_not_ready');
    }

    const cached = useCache ? this.cache.get(partnerId) : undefined;
    if (cached && cached.expiresAt - Date.now() > TOKEN_REUSE_BUFFER_MS) {
      return { token: cached.token, url };
    }

    const tokenUrl = this.appConfig.idrsOauthTokenUrl();
    if (!tokenUrl) {
      throw new IdrsCredentialsError(
        'IDRS_OAUTH_TOKEN_URL is not configured or not https',
        'idrs_not_ready'
      );
    }

    const connectionInfo = await this.appConfig.getIdrsConnectionInfo(partnerId);
    if (!connectionInfo) {
      throw new IdrsCredentialsError(
        `no IDRS connection info for partner ${partnerId}`,
        'idrs_not_ready'
      );
    }

    const { token, expiresIn } = await this.requestToken(tokenUrl, partnerId, url, connectionInfo);

    const lifetimeMs =
      typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn * 1000 : 0;
    if (!useCache) return { token, url };

    if (lifetimeMs > TOKEN_REUSE_BUFFER_MS) {
      this.cache.set(partnerId, { token, expiresAt: Date.now() + lifetimeMs });
    } else {
      // Tokens with expiration less then the buffer still work, but will not
      // be cached. Same for tokens without expiration or malformed expiration.
      // Log the lifetime we derived, never the raw expires_in — that is untrusted
      // response content, and 0 already distinguishes "unusable" from "short but valid".
      this.logger.warn(
        `identity service token: partnerId=${partnerId} not cacheable (lifetimeMs=${lifetimeMs})`
      );
    }

    return { token, url };
  }

  private async requestToken(
    tokenUrl: string,
    partnerId: string,
    idrsUrl: string,
    connectionInfo: { clientId: string; clientSecret: string }
  ): Promise<{ token: string; expiresIn: unknown }> {
    // Form-encoded, not JSON: RFC 6749 §4.4.2 specifies the token endpoint
    // takes its parameters as application/x-www-form-urlencoded. JSON is the
    // response format. URLSearchParams also escapes the client secret, which
    // is arbitrary text.
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: connectionInfo.clientId,
      client_secret: connectionInfo.clientSecret,
      // The configured IDRS url doubles as the OAuth audience and must be sent
      // exactly as configured.
      audience: idrsUrl,
      scope: `student:identity:read partner:${partnerId}`,
    });

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      // The transport error's own message is foreign text; name it only.
      throw new IdrsCredentialsError(
        `IDRS token request failed (${err instanceof Error ? err.name : 'unknown error'})`,
        'identity_service_unavailable'
      );
    }

    if (!response.ok) {
      // Status only — an OAuth error body can echo back credentials.
      throw new IdrsCredentialsError(
        `IDRS token request rejected with status ${response.status}`,
        [400, 401, 403].includes(response.status)
          ? 'idrs_not_ready'
          : 'identity_service_unavailable'
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new IdrsCredentialsError(
        'IDRS token response was not JSON',
        'identity_service_unavailable'
      );
    }
    // `null` and arrays are valid JSON and both pass `typeof === 'object'`.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new IdrsCredentialsError(
        'IDRS token response was not a JSON object',
        'identity_service_unavailable'
      );
    }

    const { access_token: token, expires_in: expiresIn } = parsed as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof token !== 'string' || token.length === 0) {
      throw new IdrsCredentialsError(
        'IDRS token response had no access_token',
        'identity_service_unavailable'
      );
    }
    return { token, expiresIn };
  }
}
