import { AppConfigService } from 'api/src/config/app-config.service';
import { IdrsCredentialsService, TOKEN_REUSE_BUFFER_MS } from './idrs-credentials.service';

const DAY_SECONDS = 24 * 60 * 60;

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body } as unknown as Response);

describe('IdrsCredentialsService', () => {
  let appConfig: jest.Mocked<Pick<AppConfigService, 'idrsOauthTokenUrl' | 'getIdrsConnectionInfo'>>;
  let service: IdrsCredentialsService;
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
    service = new IdrsCredentialsService(appConfig as unknown as AppConfigService);

    // spyOn rather than assignment: restoreAllMocks only undoes the former.
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        okResponse({ access_token: 'access-token', expires_in: DAY_SECONDS })
      ) as unknown as jest.Mock;

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

  it('reuses a cached token without touching the secret or the token endpoint', async () => {
    await service.getCredentials('partner-a');
    const second = await service.getCredentials('partner-a');

    expect(second.token).toBe('access-token');
    expect(appConfig.getIdrsConnectionInfo).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints a new token once the cached one has less life left than the buffer', async () => {
    const mintedAt = Date.parse('2026-09-14T00:00:00Z');
    const now = jest.spyOn(Date, 'now').mockReturnValue(mintedAt);

    await service.getCredentials('partner-a');
    fetchMock.mockResolvedValue(okResponse({ access_token: 'fresh', expires_in: DAY_SECONDS }));

    // A second more than the buffer left: the cached token is served.
    now.mockReturnValue(mintedAt + DAY_SECONDS * 1000 - TOKEN_REUSE_BUFFER_MS - 1000);
    expect((await service.getCredentials('partner-a')).token).toBe('access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Exactly the buffer left, which is not more than it: a replacement is minted.
    now.mockReturnValue(mintedAt + DAY_SECONDS * 1000 - TOKEN_REUSE_BUFFER_MS);
    expect((await service.getCredentials('partner-a')).token).toBe('fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Sequential rather than concurrent: two calls racing an empty cache would
  // still pass if the cache returned any partner's entry to any caller.
  it('keeps tokens separate per partner, on both the miss and the reuse path', async () => {
    appConfig.getIdrsConnectionInfo.mockImplementation(async (partnerId: string) => ({
      clientId: `${partnerId}-id`,
      clientSecret: `${partnerId}-secret`,
      url: `https://idrs.example.test/${partnerId}`,
    }));
    fetchMock
      .mockResolvedValueOnce(okResponse({ access_token: 'token-a', expires_in: DAY_SECONDS }))
      .mockResolvedValueOnce(okResponse({ access_token: 'token-b', expires_in: DAY_SECONDS }));

    const credentialsFor = (partnerId: string) => ({
      token: partnerId === 'partner-a' ? 'token-a' : 'token-b',
      url: `https://idrs.example.test/${partnerId}`,
    });

    // A and B mint; the second round must come from each partner's own entry.
    for (const partnerId of ['partner-a', 'partner-b', 'partner-a', 'partner-b']) {
      expect(await service.getCredentials(partnerId)).toEqual(credentialsFor(partnerId));
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Production tokens carry a 24h expires_in. Anything else still works, it
  // just can't be reused — the token must come back either way.
  it.each([
    ['a short lifetime', 60],
    ['a non-numeric expires_in', 'OAUTH-BODY-SENTINEL'],
  ])('returns a token with %s without caching it', async (_label, expiresIn) => {
    fetchMock.mockResolvedValue(okResponse({ access_token: 'uncacheable', expires_in: expiresIn }));

    expect((await service.getCredentials('partner-a')).token).toBe('uncacheable');
    expect((await service.getCredentials('partner-a')).token).toBe('uncacheable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const combined = logs.join('\n');
    expect(combined).toContain('not cacheable');
    for (const secret of ['uncacheable', 'OAUTH-BODY-SENTINEL', 'client-secret', 'client-id']) {
      expect(combined).not.toContain(secret);
    }
  });

  describe('failures', () => {
    it('fails when the token endpoint is unset, before touching anything else', async () => {
      appConfig.idrsOauthTokenUrl.mockReturnValue(null);

      await expect(service.getCredentials('partner-a')).rejects.toThrow(
        'IDRS_OAUTH_TOKEN_URL is not configured or not https'
      );
      expect(appConfig.getIdrsConnectionInfo).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // The transport error's own message is foreign text; carry the name only,
    // so whatever reaches a log downstream is a message we wrote.
    it('fails on a network error without carrying its message', async () => {
      const transport = new Error('UPSTREAM-MESSAGE-SENTINEL');
      transport.name = 'TypeError';
      fetchMock.mockRejectedValue(transport);

      const err = await service.getCredentials('partner-a').catch((e) => e);

      expect(err.message).toBe('IDRS token request failed (TypeError)');
      expect(String(err)).not.toContain('UPSTREAM-MESSAGE-SENTINEL');
    });

    // `null` is valid JSON and passes `typeof === 'object'`; reading through it
    // would throw a raw TypeError instead.
    it.each([[null], [{ access_token: '' }]])('rejects the response body %p', async (body) => {
      fetchMock.mockResolvedValue(okResponse(body));

      await expect(service.getCredentials('partner-a')).rejects.toThrow(/^IDRS token response /);
    });

    it('replaces a parse failure, whose message would quote the body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError(`Unexpected token '<', "OAUTH-BODY-SENTINEL" is not valid JSON`);
        },
      } as unknown as Response);

      const err = await service.getCredentials('partner-a').catch((e) => e);

      expect(err.message).toBe('IDRS token response was not JSON');
      expect(String(err)).not.toContain('OAUTH-BODY-SENTINEL');
    });
  });
});
