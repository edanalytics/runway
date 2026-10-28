import request from 'supertest';
import { Logger } from '@nestjs/common';
import { userA } from '../fixtures/user-fixtures';
import { tenantA } from '../fixtures/context-fixtures/tenant-fixtures';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { stubIdrsConfig } from '../helpers/stub-idrs';
import { IdrsCredentialsService } from '../../src/idrs/idrs-credentials.service';

const endpoint = '/partners/id-matching-mode';
const tokenUrl = 'https://auth.example.test/token';
const idrsUrl = 'https://idrs.example.test/base/';
const scopes = [`partner:${partnerA.id}`, 'student:identity:read'];
const response = (body: unknown, status = 200) =>
  ({ ok: status === 200, status, json: async () => body } as Response);

describe('partner matching-mode enablement gate', () => {
  let cookie: string;
  let config: ReturnType<typeof stubIdrsConfig>;
  let fetchSpy: jest.SpyInstance;
  let tokenResponse: Response;
  let verifyResponse: Response;
  let logs: string[];

  const save = (idMatchingMode = 'fuzzy') =>
    request(app.getHttpServer()).put(endpoint).set('Cookie', [cookie]).send({ idMatchingMode });

  beforeEach(async () => {
    cookie = (await authHelper.login(idpA, userA, tenantA, 'runway.test.partneradmin')).cookies;
    config = stubIdrsConfig({ idrsUrl, tokenUrl });
    tokenResponse = response({ access_token: 'TOKEN-SENTINEL', expires_in: 86400 });
    verifyResponse = response({ scopes });
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === tokenUrl) return tokenResponse;
      if (url === `${idrsUrl}token/verify`) return verifyResponse;
      throw new Error('unexpected URL');
    });
    logs = [];
    for (const method of ['warn', 'error', 'log'] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  const expectFailure = async (status: number) => {
    const res = await save();
    expect(res.status).toBe(status);
    expect(res.body).toEqual({
      statusCode: status,
      code: status === 422 ? 'idrs_not_ready' : 'identity_service_unavailable',
      message: expect.any(String),
    });
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } })).idMatchingMode)
      .toBe('id_based');
    const output = JSON.stringify([res.body, logs]);
    for (const secret of ['TOKEN-SENTINEL', 'UPSTREAM-SENTINEL', `${partnerA.id}-secret`]) {
      expect(output).not.toContain(secret);
    }
  };

  it.each(['fuzzy', 'id_based_fuzzy_background'])('verifies fresh credentials before saving %s', async (mode) => {
    verifyResponse = response({ scopes: [...scopes, 'extra:scope'], partners: ['irrelevant'] });
    const res = await save(mode);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ idMatchingMode: mode });
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } })).idMatchingMode).toBe(mode);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([tokenUrl, `${idrsUrl}token/verify`]);
    const oauth = new URLSearchParams(fetchSpy.mock.calls[0][1].body.toString());
    expect(oauth.get('audience')).toBe(idrsUrl);
    expect(oauth.get('scope')).toBe(`student:identity:read partner:${partnerA.id}`);
    expect(fetchSpy.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'GET', headers: { Authorization: 'Bearer TOKEN-SENTINEL' }, signal: expect.any(AbortSignal),
    }));
    // Enablement must not populate the ordinary runtime token cache.
    await app.get(IdrsCredentialsService).getCredentials(partnerA.id);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it.each([[], ['student:identity:read'], [`partner:${partnerA.id}`],
    ['partner:other', 'student:identity:read'], [`partner:${partnerA.id}`, 'STUDENT:IDENTITY:READ']].map((values) => ({ values })))(
    'rejects insufficient verified scopes %j', async ({ values }) => {
      verifyResponse = response({ scopes: values });
      await expectFailure(422);
    });

  it.each([null, [], {}, { scopes: null }, { scopes: 'student:identity:read' }, { scopes: [1] }])(
    'treats unusable verification response %j as unavailable', async (body) => {
      verifyResponse = response(body);
      await expectFailure(503);
    });

  it.each([401, 403, 500, 503])('handles IDRS verification status %i', async (status) => {
    verifyResponse = response({ detail: 'UPSTREAM-SENTINEL' }, status);
    await expectFailure(status < 500 ? 422 : 503);
  });

  it.each([400, 401, 500, 503])('handles OAuth status %i', async (status) => {
    tokenResponse = response({ detail: 'UPSTREAM-SENTINEL' }, status);
    await expectFailure(status < 500 ? 422 : 503);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['token', 'verify'])('handles malformed JSON from %s', async (stage) => {
    const broken = response(null);
    broken.json = async () => { throw new SyntaxError('UPSTREAM-SENTINEL'); };
    if (stage === 'token') tokenResponse = broken;
    else verifyResponse = broken;
    await expectFailure(503);
  });

  it.each(['TypeError', 'TimeoutError'])('handles verification transport failure %s', async (name) => {
    fetchSpy.mockImplementation(async (url) => {
      if (url === tokenUrl) return tokenResponse;
      throw Object.assign(new Error('UPSTREAM-SENTINEL'), { name });
    });
    await expectFailure(503);
  });

  it('requires the fresh token even when a previous token is cached', async () => {
    await app.get(IdrsCredentialsService).getCredentials(partnerA.id);
    jest.spyOn(config, 'getIdrsConnectionInfo').mockResolvedValue(null);
    await expectFailure(422);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['idrsUrl', 'idrsOauthTokenUrl', 'getIdrsConnectionInfo'] as const)(
    'rejects missing %s', async (getter) => {
      if (getter === 'getIdrsConnectionInfo') jest.spyOn(config, getter).mockResolvedValue(null);
      else jest.spyOn(config, getter).mockReturnValue(null);
      await expectFailure(422);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

  it('treats a secret service failure as unavailable without leaking its error', async () => {
    jest.spyOn(config, 'getIdrsConnectionInfo').mockRejectedValue(new Error('UPSTREAM-SENTINEL'));
    await expectFailure(503);
  });
});
