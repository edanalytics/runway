import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { IEnvironmentVariables } from './env-vars.interface';

describe('AppConfigService IDRS connection info', () => {
  let env: Record<string, string | undefined>;
  let service: AppConfigService;
  let send: jest.Mock;

  const secretValue = (overrides: Record<string, unknown> = {}) => ({
    SecretString: JSON.stringify({
      clientId: 'idrs-client-id',
      clientSecret: 'idrs-client-secret',
      url: 'https://idrs.example.test/base',
      ...overrides,
    }),
  });

  beforeEach(() => {
    env = { NODE_ENV: 'production', ENVLABEL: 'stage', AWS_REGION: 'us-east-1' };
    service = new AppConfigService({
      get: (key: string) => env[key],
    } as unknown as ConfigService<IEnvironmentVariables>);

    send = jest.fn().mockResolvedValue(secretValue());
    (service as unknown as { secretsClient: { send: jest.Mock } }).secretsClient.send = send;
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the partner secret', async () => {
    const info = await service.getIdrsConnectionInfo('partner-a');

    expect(info).toEqual({
      clientId: 'idrs-client-id',
      clientSecret: 'idrs-client-secret',
      url: 'https://idrs.example.test/base',
    });
    expect(send.mock.calls[0][0].input.SecretId).toBe('stage-idrs-connection-info-partner-a');
  });

  it('fetches uncached so a rotated secret is picked up without a restart', async () => {
    await service.getIdrsConnectionInfo('partner-a');
    send.mockResolvedValue(secretValue({ clientSecret: 'rotated' }));

    expect((await service.getIdrsConnectionInfo('partner-a'))?.clientSecret).toBe('rotated');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reads IDRS_* environment values instead of AWS in local development', async () => {
    env.NODE_ENV = 'development';
    env.IDRS_CLIENT_ID = 'local-id';
    env.IDRS_CLIENT_SECRET = 'local-secret';
    // http is fine locally; the https requirement applies to deployed envs.
    env.IDRS_URL = 'http://localhost:8080';

    const info = await service.getIdrsConnectionInfo('partner-a');

    expect(info).toEqual({
      clientId: 'local-id',
      clientSecret: 'local-secret',
      url: 'http://localhost:8080',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null when the local values are missing', async () => {
    env.NODE_ENV = 'development';

    expect(await service.getIdrsConnectionInfo('partner-a')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null when no secret is provisioned', async () => {
    const notFound = new Error('nope');
    notFound.name = 'ResourceNotFoundException';
    send.mockRejectedValue(notFound);

    expect(await service.getIdrsConnectionInfo('partner-a')).toBeNull();
  });

  it('lets real AWS failures throw', async () => {
    const denied = new Error('denied');
    denied.name = 'AccessDeniedException';
    send.mockRejectedValue(denied);

    await expect(service.getIdrsConnectionInfo('partner-a')).rejects.toThrow('denied');
  });

  // Secrets Manager content is untrusted at runtime whatever the type says. A
  // numeric clientId would be coerced by URLSearchParams and come back as an
  // OAuth rejection, pointing diagnosis at the wrong dependency. `null`
  // additionally passes `typeof === 'object'`.
  it.each([
    ['null', 'null'],
    [
      'a numeric clientId',
      JSON.stringify({ clientId: 1, clientSecret: 's', url: 'https://a.test' }),
    ],
    ['a missing url', JSON.stringify({ clientId: 'a', clientSecret: 's' })],
    ['a non-https url', JSON.stringify({ clientId: 'a', clientSecret: 's', url: 'http://a.test' })],
  ])('returns null for a secret body that is %s', async (_label, secretString) => {
    send.mockResolvedValue({ SecretString: secretString });

    expect(await service.getIdrsConnectionInfo('partner-a')).toBeNull();
  });

  it('preserves the configured url exactly, since it doubles as the OAuth audience', async () => {
    send.mockResolvedValue(secretValue({ url: 'https://IDRS.Example.test/base/' }));

    expect((await service.getIdrsConnectionInfo('partner-a'))?.url).toBe(
      'https://IDRS.Example.test/base/'
    );
  });

  // The client secret travels in the token request body, so a plaintext
  // endpoint exposes the credential rather than merely failing a job.
  describe('idrsOauthTokenUrl', () => {
    it('returns a configured https endpoint', () => {
      env.IDRS_OAUTH_TOKEN_URL = 'https://auth.example.test/oauth/token';

      expect(service.idrsOauthTokenUrl()).toBe('https://auth.example.test/oauth/token');
    });

    it('returns null when unset', () => {
      expect(service.idrsOauthTokenUrl()).toBeNull();
    });

    it('refuses a deployed http endpoint', () => {
      env.IDRS_OAUTH_TOKEN_URL = 'http://auth.example.test/oauth/token';

      expect(service.idrsOauthTokenUrl()).toBeNull();
    });

    it('allows http locally', () => {
      env.NODE_ENV = 'development';
      env.IDRS_OAUTH_TOKEN_URL = 'http://localhost:8080/oauth/token';

      expect(service.idrsOauthTokenUrl()).toBe('http://localhost:8080/oauth/token');
    });
  });
});
