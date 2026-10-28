import request from 'supertest';
import { userA } from '../fixtures/user-fixtures';
import { tenantA } from '../fixtures/context-fixtures/tenant-fixtures';
import { partnerA } from '../fixtures/context-fixtures/partner-fixtures';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { stubIdrsConfig } from '../helpers/stub-idrs';

const endpoint = '/partners/id-matching-mode';
const tokenUrl = 'https://auth.example.test/token';
// A base path and trailing slash guard joining the verify route.
const idrsUrl = 'https://idrs.example.test/base/';
const verifyUrl = `${idrsUrl}token/verify`;
const response = (body: unknown, status = 200) =>
  ({ ok: status === 200, status, json: async () => body } as Response);
const scopes = [`partner:${partnerA.id}`, 'student:identity:read'];
const savedMode = async () =>
  (await prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } })).idMatchingMode;

describe('partner matching mode', () => {
  let cookie: string;
  let config: ReturnType<typeof stubIdrsConfig>;
  let fetchSpy: jest.SpyInstance;
  // An Error is thrown in place of a response, as a network failure would be.
  let verifyResponse: Response | Error;

  beforeEach(async () => {
    cookie = (await authHelper.login(idpA, userA, tenantA, 'runway.test.partneradmin')).cookies;
    config = stubIdrsConfig({ idrsUrl, tokenUrl });
    verifyResponse = response({ scopes: [...scopes, 'extra:scope'] });
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === tokenUrl) return response({ access_token: 'token', expires_in: 86400 });
      if (url === verifyUrl) {
        if (verifyResponse instanceof Error) throw verifyResponse;
        return verifyResponse;
      }
      throw new Error(`unexpected URL ${url}`);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const save = (idMatchingMode: string, session = cookie) =>
    request(app.getHttpServer()).put(endpoint).set('Cookie', [session]).send({ idMatchingMode });

  it.each(['fuzzy', 'id_based_fuzzy_background'])(
    'saves %s once IDRS verifies access',
    async (mode) => {
      const res = await save(mode);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ idMatchingMode: mode });
      expect(fetchSpy).toHaveBeenLastCalledWith(
        verifyUrl,
        expect.objectContaining({ headers: { Authorization: 'Bearer token' } })
      );
      const read = await request(app.getHttpServer()).get(endpoint).set('Cookie', [cookie]);
      expect(read.body).toEqual({ idMatchingMode: mode });
    }
  );

  it.each([
    { case: 'a token without the partner scope', verify: response({ scopes: [scopes[1]] }) },
    { case: 'a token without the search scope', verify: response({ scopes: [scopes[0]] }) },
    {
      case: "another partner's scope",
      verify: response({ scopes: ['partner:other', 'student:identity:read'] }),
    },
    { case: 'space-delimited scopes', verify: response({ scopes: scopes.join(' ') }) },
    { case: 'a rejected token', verify: response({}, 401) },
    {
      case: 'a malformed response',
      verify: {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response,
    },
    { case: 'a network failure', verify: new TypeError('fetch failed') },
  ])('refuses $case and keeps the saved mode', async ({ verify }) => {
    verifyResponse = verify;
    expect((await save('fuzzy')).status).toBe(400);
    expect(await savedMode()).toBe('id_based');
  });

  it('drops a refused token, so a retry after the fix mints a new one', async () => {
    let minted = 0;
    fetchSpy.mockImplementation(async (url, init) => {
      if (url === tokenUrl)
        return response({ access_token: `token-${++minted}`, expires_in: 86400 });
      // Only the token minted after the partner's scope is fixed carries it.
      const fixed = (init?.headers as Record<string, string>).Authorization === 'Bearer token-2';
      return response({ scopes: fixed ? scopes : [scopes[1]] });
    });
    expect((await save('fuzzy')).status).toBe(400);
    expect((await save('fuzzy')).status).toBe(200);
  });

  it('refuses without the partner’s IDRS connection info', async () => {
    jest.spyOn(config, 'getIdrsConnectionInfo').mockResolvedValue(null);
    expect((await save('fuzzy')).status).toBe(400);
    expect(await savedMode()).toBe('id_based');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saves id_based without contacting IDRS', async () => {
    await prisma.partner.update({ where: { id: partnerA.id }, data: { idMatchingMode: 'fuzzy' } });
    const res = await save('id_based');
    expect(res.status).toBe(200);
    expect(await savedMode()).toBe('id_based');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['get', 'put'] as const)(
    'refuses %s to users who are not partner admins',
    async (method) => {
      const session = (
        await authHelper.login(idpA, userA, tenantA, [
          'runway.test.user',
          'runway.test.supportuser',
        ])
      ).cookies;
      const res = await request(app.getHttpServer())
        [method](endpoint)
        .set('Cookie', [session])
        .send({ idMatchingMode: 'fuzzy' });
      expect(res.status).toBe(403);
      expect(await savedMode()).toBe('id_based');
    }
  );
});
