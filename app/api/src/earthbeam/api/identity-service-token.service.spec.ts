import { AppConfigService } from 'api/src/config/app-config.service';
import {
  IdentityServiceTokenError,
  IdentityServiceTokenService,
  OAUTH_TIMEOUT_MS,
  TOKEN_REUSE_BUFFER_MS,
} from './identity-service-token.service';

const DAY_SECONDS = 24 * 60 * 60;

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body } as unknown as Response);

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

    fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse({ access_token: 'access-token', expires_in: DAY_SECONDS }));
    global.fetch = fetchMock as unknown as typeof fetch;

    logs = [];
    const capture = (message: unknown) => {
      logs.push(String(message));
    };
    jest.spyOn((service as any).logger, 'warn').mockImplementation(capture);
    jest.spyOn((service as any).logger, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests a partner-scoped client-credentials token from the configured endpoint', async () => {
    const result = await service.getCredentials('partner-a');

    expect(result).toEqual({ token: 'access-token', url: 'https://idrs.example.test/base' });
    expect(appConfig.getIdrsConnectionInfo).toHaveBeenCalledWith('partner-a');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.example.test/oauth/token');
    expect(init.method).toBe('POST');

    const body = new URLSearchParams(init.body.toString());
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    // The audience must be the configured URL verbatim — no normalization.
    expect(body.get('audience')).toBe('https://idrs.example.test/base');
    expect(body.get('scope')).toBe('student:identity:read partner:partner-a');
  });

  it('bounds the token request at five seconds', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

    await service.getCredentials('partner-a');

    expect(timeoutSpy).toHaveBeenCalledWith(OAUTH_TIMEOUT_MS);
    expect(OAUTH_TIMEOUT_MS).toBe(5000);
  });

  it('does no dependency work until credentials are actually requested', () => {
    expect(appConfig.idrsOauthTokenUrl).not.toHaveBeenCalled();
    expect(appConfig.getIdrsConnectionInfo).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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

    const cached = (service as any).cache.get('partner-a');
    jest.spyOn(Date, 'now').mockReturnValue(cached.expiresAt - TOKEN_REUSE_BUFFER_MS);

    expect((await service.getCredentials('partner-a')).token).toBe('fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps tokens separate per partner', async () => {
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
  });

  // Production tokens carry a 24h expires_in. Anything else still works, it
  // just can't be reused — the token must come back either way.
  it.each([
    ['a short lifetime', 60],
    ['no expires_in', undefined],
    ['a non-numeric expires_in', 'soon'],
  ])('returns a token with %s without caching it', async (_label, expiresIn) => {
    fetchMock.mockResolvedValue(okResponse({ access_token: 'uncacheable', expires_in: expiresIn }));

    expect((await service.getCredentials('partner-a')).token).toBe('uncacheable');
    expect((await service.getCredentials('partner-a')).token).toBe('uncacheable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes('not cacheable'))).toBe(true);
  });

  describe('failures', () => {
    it('fails when the token endpoint is unset, before touching anything else', async () => {
      appConfig.idrsOauthTokenUrl.mockReturnValue(null);

      await expect(service.getCredentials('partner-a')).rejects.toBeInstanceOf(
        IdentityServiceTokenError
      );
      expect(appConfig.getIdrsConnectionInfo).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails when the partner has no connection info', async () => {
      appConfig.getIdrsConnectionInfo.mockResolvedValue(null);

      await expect(service.getCredentials('partner-a')).rejects.toBeInstanceOf(
        IdentityServiceTokenError
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not retry, and reports only the status from a rejected request', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);

      const err = await service.getCredentials('partner-a').catch((e) => e);

      expect(err).toBeInstanceOf(IdentityServiceTokenError);
      expect(err.upstream).toBe('status=401');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('socket hang up'));

      await expect(service.getCredentials('partner-a')).rejects.toBeInstanceOf(
        IdentityServiceTokenError
      );
    });

    // `null` and arrays are valid JSON and both pass `typeof === 'object'`;
    // reading through them would throw a raw TypeError instead.
    it.each([[null], [[]], [{}], [{ access_token: '' }]])(
      'rejects the response body %p',
      async (body) => {
        fetchMock.mockResolvedValue(okResponse(body));

        await expect(service.getCredentials('partner-a')).rejects.toBeInstanceOf(
          IdentityServiceTokenError
        );
      }
    );

    it('rejects a body that is not JSON at all', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response);

      await expect(service.getCredentials('partner-a')).rejects.toBeInstanceOf(
        IdentityServiceTokenError
      );
    });
  });

  it('never logs credentials or tokens', async () => {
    // Distinctive values so a leak can't hide inside ordinary log vocabulary.
    fetchMock.mockResolvedValue(okResponse({ access_token: 'SECRET-TOKEN', expires_in: 60 }));
    await service.getCredentials('partner-a');
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);
    await service.getCredentials('partner-b').catch(() => undefined);

    expect(logs.length).toBeGreaterThan(0);
    const combined = logs.join('\n');
    expect(combined).not.toContain('SECRET-TOKEN');
    expect(combined).not.toContain('client-secret');
    expect(combined).not.toContain('client-id');
  });
});
