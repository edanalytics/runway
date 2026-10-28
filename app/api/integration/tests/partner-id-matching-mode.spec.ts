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
const savedMode = async () =>
  (await prisma.partner.findUniqueOrThrow({ where: { id: partnerA.id } })).idMatchingMode;

describe('partner matching mode', () => {
  let cookie: string;
  let config: ReturnType<typeof stubIdrsConfig>;
  let fetchSpy: jest.SpyInstance;
  let verifyResponse: Response;

  beforeEach(async () => {
    cookie = (await authHelper.login(idpA, userA, tenantA, 'runway.test.partneradmin')).cookies;
    config = stubIdrsConfig({ idrsUrl, tokenUrl });
    verifyResponse = response({
      scopes: [`partner:${partnerA.id}`, 'student:identity:read', 'extra:scope'],
    });
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url === tokenUrl) return response({ access_token: 'token', expires_in: 86400 });
      if (url === verifyUrl) return verifyResponse;
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
    { cause: 'the partner scope', scopes: ['student:identity:read'] },
    { cause: 'the search scope', scopes: [`partner:${partnerA.id}`] },
    { cause: "the partner's own scope", scopes: ['partner:other', 'student:identity:read'] },
  ])('refuses a token without $cause and keeps the saved mode', async ({ scopes }) => {
    verifyResponse = response({ scopes });
    const res = await save('fuzzy');
    expect(res.status).toBe(400);
    expect(await savedMode()).toBe('id_based');
  });

  it('refuses when IDRS rejects the token', async () => {
    verifyResponse = response({}, 401);
    expect((await save('fuzzy')).status).toBe(400);
    expect(await savedMode()).toBe('id_based');
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
