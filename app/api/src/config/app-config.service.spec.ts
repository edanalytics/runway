import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { IEnvironmentVariables } from './env-vars.interface';

describe('AppConfigService IDRS connection info', () => {
  let env: Record<string, string | undefined>;
  let service: AppConfigService;
  let send: jest.Mock;
  let logs: string[];

  const secretValue = (overrides: Record<string, unknown> = {}) => ({
    SecretString: JSON.stringify({
      clientId: 'idrs-client-id',
      clientSecret: 'idrs-client-secret',
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
    logs = [];
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation((message: unknown) => void logs.push(String(message)));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the partner secret', async () => {
    const info = await service.getIdrsConnectionInfo('partner-a');

    expect(info).toEqual({
      clientId: 'idrs-client-id',
      clientSecret: 'idrs-client-secret',
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

    const info = await service.getIdrsConnectionInfo('partner-a');

    expect(info).toEqual({ clientId: 'local-id', clientSecret: 'local-secret' });
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
    ['a numeric clientId', JSON.stringify({ clientId: 1, clientSecret: 's' })],
    ['missing a clientSecret', JSON.stringify({ clientId: 'a' })],
    // fetchAWSSecret treats an unparseable body as a plain-text secret and
    // hands back the raw string, which has no fields to read.
    ['not JSON at all', 'plaintext-secret'],
  ])('returns null for a secret body that is %s', async (_label, secretString) => {
    send.mockResolvedValue({ SecretString: secretString });

    expect(await service.getIdrsConnectionInfo('partner-a')).toBeNull();
  });

  // The malformed branch is the one that logs, and the one where quoting the
  // body to explain what was wrong would be most tempting. Only the secret
  // name belongs on that line.
  it('names the secret without quoting its contents when it is malformed', async () => {
    // Numeric so the pair is rejected and reaches the warn, with both values
    // still present in the body the logger could have reached for.
    send.mockResolvedValue({
      SecretString: JSON.stringify({ clientId: 1234, clientSecret: 'SECRET-SENTINEL' }),
    });

    expect(await service.getIdrsConnectionInfo('partner-a')).toBeNull();
    const combined = logs.join('\n');
    expect(combined).toContain('stage-idrs-connection-info-partner-a');
    for (const value of ['SECRET-SENTINEL', '1234']) {
      expect(combined).not.toContain(value);
    }
  });

  describe('idrsUrl', () => {
    it('preserves the configured url exactly, since it doubles as the OAuth audience', () => {
      env.IDRS_URL = 'https://IDRS.Example.test/base/';

      expect(service.idrsUrl()).toBe('https://IDRS.Example.test/base/');
    });

    it('returns null when unset', () => {
      expect(service.idrsUrl()).toBeNull();
    });

    // Student identity data comes back over this connection.
    it('refuses a deployed http url', () => {
      env.IDRS_URL = 'http://idrs.example.test';

      expect(service.idrsUrl()).toBeNull();
    });

    it('allows http locally', () => {
      env.NODE_ENV = 'development';
      env.IDRS_URL = 'http://localhost:8080';

      expect(service.idrsUrl()).toBe('http://localhost:8080');
    });
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
