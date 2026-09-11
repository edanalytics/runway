import { AppConfigService, IdrsConnectionInfoError } from 'api/src/config/app-config.service';
import {
  IdentityServiceTokenError,
  IdentityServiceTokenService,
  TOKEN_REUSE_BUFFER_MS,
} from './identity-service-token.service';

const DAY_SECONDS = 24 * 60 * 60;

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body } as unknown as Response);
const errorResponse = (status: number) =>
  ({ ok: false, status, json: async () => ({}) } as unknown as Response);

describe('IdentityServiceTokenService', () => {
  let appConfig: jest.Mocked<Pick<AppConfigService, 'idrsOauthTokenUrl' | 'getIdrsConnectionInfo'>>;
  let service: IdentityServiceTokenService;
  let fetchMock: jest.Mock;
  let logs: string[];

  beforeEach(() => {
    appConfig = {
      idrsOauthTokenUrl: jest.fn().mockReturnValue('https://auth.example.test/oauth/token'),
      getIdrsConnectionInfo: jest.fn().mockResolvedValue({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        url: 'https://idrs.example.test/base',
      }),
    };
    service = new IdentityServiceTokenService(appConfig as unknown as AppConfigService);

    fetchMock = jest.fn().mockResolvedValue(
      okResponse({ access_token: 'access-token', expires_in: DAY_SECONDS })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    // No backoff jitter, so the retry path doesn't make tests sleep.
    jest.spyOn(Math, 'random').mockReturnValue(0);

    logs = [];
    const capture = (message: unknown) => {
      logs.push(String(message));
    };
    jest.spyOn((service as any).logger, 'warn').mockImplementation(capture);
    jest.spyOn((service as any).logger, 'error').mockImplementation(capture);
    jest.spyOn((service as any).logger, 'log').mockImplementation(capture);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const bodyOf = (call: number) =>
    new URLSearchParams(fetchMock.mock.calls[call][1].body.toString());

  it('does no dependency work until credentials are actually requested', () => {
    expect(appConfig.idrsOauthTokenUrl).not.toHaveBeenCalled();
    expect(appConfig.getIdrsConnectionInfo).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests a partner-scoped client-credentials token from the configured endpoint', async () => {
    const result = await service.getCredentials('partner-a');

    expect(result).toEqual({ token: 'access-token', url: 'https://idrs.example.test/base' });
    expect(appConfig.getIdrsConnectionInfo).toHaveBeenCalledWith('partner-a');
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.example.test/oauth/token');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');

    const body = bodyOf(0);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    // The audience must be the configured URL verbatim — no normalization.
    expect(body.get('audience')).toBe('https://idrs.example.test/base');
    expect(body.get('scope')).toBe('student:identity:read partner:partner-a');
  });

  it('reuses a cached token without touching the secret or the token endpoint', async () => {
    await service.getCredentials('partner-a');
    const second = await service.getCredentials('partner-a');

    expect(second.token).toBe('access-token');
    expect(appConfig.getIdrsConnectionInfo).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints a new token once the cached one enters the reuse window', async () => {
    await service.getCredentials('partner-a');
    fetchMock.mockResolvedValue(okResponse({ access_token: 'fresh', expires_in: DAY_SECONDS }));

    // Advance past the point where the cached token has only the buffer left.
    const cached = (service as any).cache.get('partner-a');
    jest.spyOn(Date, 'now').mockReturnValue(cached.expiresAt - TOKEN_REUSE_BUFFER_MS);

    const second = await service.getCredentials('partner-a');

    expect(second.token).toBe('fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps tokens and in-flight work separate per partner', async () => {
    appConfig.getIdrsConnectionInfo.mockImplementation(async (partnerId: string) => ({
      clientId: `${partnerId}-id`,
      clientSecret: `${partnerId}-secret`,
      url: `https://idrs.example.test/${partnerId}`,
    }));
    fetchMock
      .mockResolvedValueOnce(okResponse({ access_token: 'token-a', expires_in: DAY_SECONDS }))
      .mockResolvedValueOnce(okResponse({ access_token: 'token-b', expires_in: DAY_SECONDS }));

    const [a, b] = await Promise.all([
      service.getCredentials('partner-a'),
      service.getCredentials('partner-b'),
    ]);

    expect(a).toEqual({ token: 'token-a', url: 'https://idrs.example.test/partner-a' });
    expect(b).toEqual({ token: 'token-b', url: 'https://idrs.example.test/partner-b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous misses for one partner onto a single lookup', async () => {
    const results = await Promise.all([
      service.getCredentials('partner-a'),
      service.getCredentials('partner-a'),
      service.getCredentials('partner-a'),
    ]);

    expect(results.map((r) => r.token)).toEqual(['access-token', 'access-token', 'access-token']);
    expect(appConfig.getIdrsConnectionInfo).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight promise after a failure so the next caller retries', async () => {
    appConfig.getIdrsConnectionInfo.mockRejectedValueOnce(
      new IdrsConnectionInfoError('secret_fetch_unavailable', 'boom')
    );

    await expect(service.getCredentials('partner-a')).rejects.toBeInstanceOf(
      IdentityServiceTokenError
    );
    const second = await service.getCredentials('partner-a');

    expect(second.token).toBe('access-token');
    expect(appConfig.getIdrsConnectionInfo).toHaveBeenCalledTimes(2);
  });

  describe('token lifetime handling', () => {
    it('returns a short-lived token without caching it', async () => {
      fetchMock.mockResolvedValue(okResponse({ access_token: 'short', expires_in: 60 }));

      const first = await service.getCredentials('partner-a');
      const second = await service.getCredentials('partner-a');

      expect(first.token).toBe('short');
      expect(second.token).toBe('short');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(logs.some((l) => l.includes('short_lived_token'))).toBe(true);
    });

    it('returns a token with no expires_in without caching it', async () => {
      fetchMock.mockResolvedValue(okResponse({ access_token: 'no-exp' }));

      const first = await service.getCredentials('partner-a');
      await service.getCredentials('partner-a');

      expect(first.token).toBe('no-exp');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(logs.some((l) => l.includes('missing_expires_in'))).toBe(true);
    });

    it.each([['not-a-number'], [0], [-5]])(
      'treats expires_in %p as an invalid token response',
      async (expiresIn) => {
        fetchMock.mockResolvedValue(okResponse({ access_token: 'x', expires_in: expiresIn }));

        await expect(service.getCredentials('partner-a')).rejects.toMatchObject({
          kind: 'auth_failed',
          causeCategory: 'oauth_invalid_response',
        });
      }
    );

    it('rejects a response with no access_token', async () => {
      fetchMock.mockResolvedValue(okResponse({ expires_in: DAY_SECONDS }));

      await expect(service.getCredentials('partner-a')).rejects.toMatchObject({
        kind: 'auth_failed',
        causeCategory: 'oauth_invalid_response',
      });
    });
  });

  describe('OAuth failure handling', () => {
    it.each([[429], [500], [503]])('retries a %p once and succeeds', async (status) => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(status))
        .mockResolvedValueOnce(
          okResponse({ access_token: 'second-try', expires_in: DAY_SECONDS })
        );

      const result = await service.getCredentials('partner-a');

      expect(result.token).toBe('second-try');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries a network failure once', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce(okResponse({ access_token: 'recovered', expires_in: DAY_SECONDS }));

      expect((await service.getCredentials('partner-a')).token).toBe('recovered');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up as unavailable after the retry also fails', async () => {
      fetchMock.mockResolvedValue(errorResponse(503));

      await expect(service.getCredentials('partner-a')).rejects.toMatchObject({
        kind: 'unavailable',
        causeCategory: 'oauth_unavailable',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([[400], [401], [403]])('does not retry a %p', async (status) => {
      fetchMock.mockResolvedValue(errorResponse(status));

      await expect(service.getCredentials('partner-a')).rejects.toMatchObject({
        kind: 'auth_failed',
        causeCategory: 'oauth_rejected',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports only the status from a rejected token request', async () => {
      fetchMock.mockResolvedValue(errorResponse(401));

      const err = await service.getCredentials('partner-a').catch((e) => e);

      expect(err.upstream).toBe('status=401');
    });
  });

  describe('configuration failures', () => {
    it('is misconfigured when the token endpoint is unset', async () => {
      appConfig.idrsOauthTokenUrl.mockReturnValue(null);

      await expect(service.getCredentials('partner-a')).rejects.toMatchObject({
        kind: 'misconfigured',
        causeCategory: 'oauth_not_configured',
      });
      // Nothing else should be attempted.
      expect(appConfig.getIdrsConnectionInfo).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['secret_not_found', 'misconfigured'],
      ['secret_access_denied', 'misconfigured'],
      ['secret_invalid', 'misconfigured'],
      ['secret_fetch_unavailable', 'unavailable'],
    ] as const)('maps %s to %s', async (causeCategory, kind) => {
      appConfig.getIdrsConnectionInfo.mockRejectedValue(
        new IdrsConnectionInfoError(causeCategory, 'nope', 'SomeAwsError', 'req-123')
      );

      await expect(service.getCredentials('partner-a')).rejects.toMatchObject({
        kind,
        causeCategory,
        upstream: 'SomeAwsError req-123',
      });
    });
  });

  it('never logs credentials or tokens on success or failure', async () => {
    // Distinctive values so a leak can't hide inside ordinary log vocabulary.
    fetchMock.mockResolvedValue(
      okResponse({ access_token: 'SECRET-LONG-LIVED', expires_in: DAY_SECONDS })
    );
    await service.getCredentials('partner-a');
    // The short-lived branch warns, which is the most likely place to overshare.
    fetchMock.mockResolvedValue(okResponse({ access_token: 'SECRET-SHORT-LIVED', expires_in: 60 }));
    await service.getCredentials('partner-b');
    fetchMock.mockResolvedValue(errorResponse(401));
    await service.getCredentials('partner-c').catch(() => undefined);

    expect(logs.length).toBeGreaterThan(0);
    const combined = logs.join('\n');
    expect(combined).not.toContain('SECRET-LONG-LIVED');
    expect(combined).not.toContain('SECRET-SHORT-LIVED');
    expect(combined).not.toContain('client-secret');
    expect(combined).not.toContain('client-id');
  });
});
