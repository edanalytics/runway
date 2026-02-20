import request from 'supertest';
import sessionStore from '../session/session-store';
import { sidFromCookie } from '../session/session-cookie';
import { IdpFixture } from '../../fixtures/context-fixtures/idp-fixtures';
import { getClaimsMocker } from './openid-client-mock';
import { Tenant, User } from '@prisma/client';

/**
 * This helper manages the auth flow for tests. Here's how you use it:
 * 1. Initiate the handshake, supplying an IdP to use.
 * 2. Use the mocked IdP you get back to configure the claims you want
 * 3. Resume the handshake with `completeAuth` and indicate whether you
 *    expect the auth to succeed or fail
 * 4. Check session data, user and tenant records, or whatever else you want.
 *    Or if all you wanted to check is that auth passed or failed you don't
 *    need to do anything else.
 *
 * There are a bunch of expect statements in this helper. Except for that final
 * pass/fail check, these are just in there to ensure the auth flow is working
 * as expected.
 *
 * This interface could use some smoothing out! Worth improving as we go but
 * polishing it isn't a priority. The goal is to allow tests to focus on configuring
 * test cases and the associated expectations and not have to deal with coordinating
 * the auth flow and it does that well enough.
 */
export const initiateAuth = async (idp: IdpFixture) => {
  const loginEndpoint = `/auth/login?origin=${idp.feHome}`;
  const callbackEndpoint = `/auth/callback/${idp.id}`;
  const res1 = await request(app.getHttpServer()).get(loginEndpoint);
  expect(res1.status).toBe(302);

  const issuerAuthEndpoint = res1.headers.location;
  const params = new URL(issuerAuthEndpoint).searchParams;
  const redirectUri = params.get('redirect_uri');

  expect(issuerAuthEndpoint).toContain(idp.oidcConfig.issuer); // we're redirecting back to the callback endpoint for our specific IdP
  expect(redirectUri).toContain(callbackEndpoint);

  const claimsMocker = getClaimsMocker(issuerAuthEndpoint);
  claimsMocker.configure(idp);

  return {
    res: res1,
    claimsMocker,
    completeAuth: async (passOrFail: 'pass' | 'fail' = 'pass') => {
      const res2 = await request(app.getHttpServer())
        .get(callbackEndpoint)
        .query({ code: 'test-code' }) // `code` needs to be passed so the strategy knows this is the redirect from the IdP but the value doesn't matter for our tests since we're mocking the IdP
        .set('Cookie', res1.headers['set-cookie']); // pass cookies from the initial request

      expect(res2.status).toBe(302);
      expect(res2.headers.location).toContain(idp.feHome);
      if (passOrFail === 'pass') {
        expect(res2.headers.location).not.toContain('/unauthenticated'); // !! Unsuccessful logins will 302 to /unauthenticated
      } else {
        expect(res2.headers.location).toContain('/unauthenticated');
      }
      if (passOrFail === 'pass') {
        const resA3 = await request(app.getHttpServer())
          .get('/auth/me')
          .set('Cookie', res2.headers['set-cookie']);
        expect(resA3.status).toBe(passOrFail === 'pass' ? 200 : 401);
      } else {
        expect(res2.headers['set-cookie']).toBeUndefined();
      }

      return {
        res: res2,
        cookies: res2.headers['set-cookie'],
        getSessionFromDB: async () => {
          const cookies = res2.headers['set-cookie'];
          if (cookies) {
            return await sessionStore.get(sidFromCookie(cookies));
          }
          return null;
        },
      };
    },
  };
};

// Helper for successful login. Returns session cookie for making subsequent requests.
const login = async (
  idp: IdpFixture,
  user: Pick<User, 'email' | 'givenName' | 'familyName'>,
  tenant: Pick<Tenant, 'code'>
) => {
  const { claimsMocker, completeAuth } = await initiateAuth(idp);
  claimsMocker.authUserInTenant(user, tenant).addRoles(idp.oidcConfig.requiredRoles[0]);
  return await completeAuth('pass');
};

const logout = async (cookie: string) => {
  const res = await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie);
  expect(res.status).toBe(200);
  const session = await sessionStore.get(sidFromCookie(cookie));
  expect(session).toBeUndefined();
  return res;
};

export const authHelper = { login, logout };
