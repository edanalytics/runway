import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from 'api/src/config/app-config.service';

/**
 * Reuse threshold, not a minimum token lifetime: a token is only served — or
 * worth caching — while more than this much life remains.
 */
export const TOKEN_REUSE_BUFFER_MS = 10 * 60 * 1000;

export type IdrsCredentials = { token: string; url: string };

type CacheEntry = { token: string; url: string; expiresAt: number };

/**
 * Resolves what the executor needs to reach IDRS on a partner's behalf: the
 * partner's base url and a freshly minted access token, cached together for
 * the just-in-time callback. The cache is per app instance and per partner, so
 * scaled instances each mint their own and observe a rotation at different
 * times — an accepted tradeoff over shared cache infrastructure.
 */
@Injectable()
export class IdrsCredentialsService {
  private readonly logger = new Logger(IdrsCredentialsService.name);

  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly appConfig: AppConfigService) {}

  async getCredentials(partnerId: string): Promise<IdrsCredentials> {
    const cached = this.cache.get(partnerId);
    if (cached && cached.expiresAt - Date.now() > TOKEN_REUSE_BUFFER_MS) {
      return { token: cached.token, url: cached.url };
    }

    const tokenUrl = this.appConfig.idrsOauthTokenUrl();
    if (!tokenUrl) {
      throw new Error('IDRS_OAUTH_TOKEN_URL is not configured or not https');
    }

    const connectionInfo = await this.appConfig.getIdrsConnectionInfo(partnerId);
    if (!connectionInfo) {
      throw new Error(`no IDRS connection info for partner ${partnerId}`);
    }

    const { token, expiresIn } = await this.requestToken(tokenUrl, partnerId, connectionInfo);

    const lifetimeMs =
      typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn * 1000 : 0;
    if (lifetimeMs > TOKEN_REUSE_BUFFER_MS) {
      // The URL is only refreshed alongside a new token, so a rotated base URL
      // can stay in use until the cached token enters the refresh window.
      this.cache.set(partnerId, {
        token,
        url: connectionInfo.url,
        expiresAt: Date.now() + lifetimeMs,
      });
    } else {
      // Production tokens carry a 24h expires_in; anything else still works,
      // it just can't be reused. Log the lifetime we derived, never the raw
      // expires_in — that is untrusted response content, and 0 already
      // distinguishes "unusable" from "short but valid".
      this.logger.warn(
        `identity service token: partnerId=${partnerId} not cacheable (lifetimeMs=${lifetimeMs})`
      );
    }

    return { token, url: connectionInfo.url };
  }

  private async requestToken(
    tokenUrl: string,
    partnerId: string,
    connectionInfo: { clientId: string; clientSecret: string; url: string }
  ): Promise<{ token: string; expiresIn: unknown }> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: connectionInfo.clientId,
      client_secret: connectionInfo.clientSecret,
      // The configured IDRS url doubles as the OAuth audience and must be sent
      // exactly as configured.
      audience: connectionInfo.url,
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
      throw new Error(
        `IDRS token request failed (${err instanceof Error ? err.name : 'unknown error'})`
      );
    }

    if (!response.ok) {
      // Status only — an OAuth error body can echo back credentials.
      throw new Error(`IDRS token request rejected with status ${response.status}`);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error('IDRS token response was not JSON');
    }
    // `null` and arrays are valid JSON and both pass `typeof === 'object'`.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('IDRS token response was not a JSON object');
    }

    const { access_token: token, expires_in: expiresIn } = parsed as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('IDRS token response had no access_token');
    }
    return { token, expiresIn };
  }
}
