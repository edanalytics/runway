import { ConfigService } from '@nestjs/config';
import { AppConfigService, IdrsConnectionInfoError } from './app-config.service';
import { IEnvironmentVariables } from './env-vars.interface';

describe('AppConfigService IDRS connection info', () => {
  let env: Record<string, string | undefined>;
  let service: AppConfigService;
  let send: jest.Mock;
  let timeoutSpy: jest.SpyInstance;

  const secretValue = (overrides: Record<string, unknown> = {}) => ({
    SecretString: JSON.stringify({
      clientID: 'idrs-client-id',
      clientSecret: 'idrs-client-secret',
      url: 'https://idrs.example.test/base',
      ...overrides,
    }),
  });

  const awsError = (name: string) => {
    const err = new Error(name);
    err.name = name;
    (err as unknown as { $metadata: { requestId: string } }).$metadata = { requestId: 'req-1' };
    return err;
  };

  beforeEach(() => {
    env = { NODE_ENV: 'production', ENVLABEL: 'stage', AWS_REGION: 'us-east-1' };
    const configService = {
      get: (key: string) => env[key],
    } as unknown as ConfigService<IEnvironmentVariables>;
    service = new AppConfigService(configService);

    send = jest.fn().mockResolvedValue(secretValue());
    (service as unknown as { secretsClient: { send: jest.Mock } }).secretsClient.send = send;

    timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the partner secret and maps clientID to clientId', async () => {
    const info = await service.getIdrsConnectionInfo('partner-a');

    expect(info).toEqual({
      clientId: 'idrs-client-id',
      clientSecret: 'idrs-client-secret',
      url: 'https://idrs.example.test/base',
    });
    expect(send.mock.calls[0][0].input.SecretId).toBe('stage-idrs-connection-info-partner-a');
  });

  it('bounds the lookup with a five-second abort signal', async () => {
    await service.getIdrsConnectionInfo('partner-a');

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('does not apply that bound to unrelated secret getters', async () => {
    env.UM_CONFIG_SECRET = 'stage-um-config';
    send.mockResolvedValue({
      SecretString: JSON.stringify({
        url: 'https://um.example.test',
        auth0Domain: 'um.auth0.test',
        clientId: 'um-id',
        clientSecret: 'um-secret',
        audience: 'https://um.example.test',
      }),
    });

    await service.umConfig();

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(send.mock.calls[0][1]).toBeUndefined();
  });

  it('fetches uncached so a rotated secret is picked up without a restart', async () => {
    await service.getIdrsConnectionInfo('partner-a');
    send.mockResolvedValue(secretValue({ clientSecret: 'rotated' }));
    const second = await service.getIdrsConnectionInfo('partner-a');

    expect(second.clientSecret).toBe('rotated');
    expect(send).toHaveBeenCalledTimes(2);
  });

  describe('local development', () => {
    beforeEach(() => {
      env.NODE_ENV = 'development';
    });

    it('reads IDRS_* environment values instead of AWS', async () => {
      env.IDRS_CLIENT_ID = 'local-id';
      env.IDRS_CLIENT_SECRET = 'local-secret';
      env.IDRS_URL = 'http://localhost:8080';

      const info = await service.getIdrsConnectionInfo('partner-a');

      expect(info).toEqual({
        clientId: 'local-id',
        clientSecret: 'local-secret',
        url: 'http://localhost:8080',
      });
      expect(send).not.toHaveBeenCalled();
    });

    it('fails as not-found when the local values are missing', async () => {
      await expect(service.getIdrsConnectionInfo('partner-a')).rejects.toMatchObject({
        causeCategory: 'secret_not_found',
      });
    });
  });

  describe('url validation', () => {
    it.each([['not-a-url'], ['/relative/path'], ['ftp://idrs.example.test']])(
      'rejects %p as invalid',
      async (url) => {
        send.mockResolvedValue(secretValue({ url }));

        await expect(service.getIdrsConnectionInfo('partner-a')).rejects.toMatchObject({
          causeCategory: 'secret_invalid',
        });
      }
    );

    it('rejects plain http outside local development', async () => {
      send.mockResolvedValue(secretValue({ url: 'http://idrs.example.test' }));

      await expect(service.getIdrsConnectionInfo('partner-a')).rejects.toMatchObject({
        causeCategory: 'secret_invalid',
      });
    });

    it('preserves the configured url exactly, since it doubles as the OAuth audience', async () => {
      send.mockResolvedValue(secretValue({ url: 'https://IDRS.Example.test/base/' }));

      const info = await service.getIdrsConnectionInfo('partner-a');

      expect(info.url).toBe('https://IDRS.Example.test/base/');
    });
  });

  describe('failure categories', () => {
    it.each([
      ['ResourceNotFoundException', 'secret_not_found'],
      ['AccessDeniedException', 'secret_access_denied'],
      ['DecryptionFailure', 'secret_invalid'],
      ['ThrottlingException', 'secret_fetch_unavailable'],
      ['TimeoutError', 'secret_fetch_unavailable'],
      ['SomethingWeNeverSaw', 'secret_fetch_unavailable'],
    ])('maps %s to %s', async (awsName, causeCategory) => {
      send.mockRejectedValue(awsError(awsName));

      const err = await service.getIdrsConnectionInfo('partner-a').catch((e) => e);

      expect(err).toBeInstanceOf(IdrsConnectionInfoError);
      expect(err.causeCategory).toBe(causeCategory);
      expect(err.awsErrorName).toBe(awsName);
      expect(err.awsRequestId).toBe('req-1');
    });

    it.each([['clientID'], ['clientSecret'], ['url']])(
      'treats a secret missing %s as invalid',
      async (field) => {
        send.mockResolvedValue(secretValue({ [field]: undefined }));

        await expect(service.getIdrsConnectionInfo('partner-a')).rejects.toMatchObject({
          causeCategory: 'secret_invalid',
        });
      }
    );

    it('treats a plain-text secret as invalid', async () => {
      send.mockResolvedValue({ SecretString: 'just-a-string' });

      await expect(service.getIdrsConnectionInfo('partner-a')).rejects.toMatchObject({
        causeCategory: 'secret_invalid',
      });
    });

    it('reports a missing ENVLABEL as not-found rather than calling AWS', async () => {
      delete env.ENVLABEL;

      await expect(service.getIdrsConnectionInfo('partner-a')).rejects.toMatchObject({
        causeCategory: 'secret_not_found',
      });
      expect(send).not.toHaveBeenCalled();
    });
  });
});
