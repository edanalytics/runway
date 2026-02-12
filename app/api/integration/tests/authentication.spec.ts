import { idpA, idpX, oidcConfigA, oidcConfigX } from '../fixtures/context-fixtures/idp-fixtures';
import { tenantA, tenantC, tenantX } from '../fixtures/context-fixtures/tenant-fixtures';
import { userA, userB, userX } from '../fixtures/user-fixtures';
import request from 'supertest';
import { authHelper, initiateAuth } from '../helpers/oidc/auth-flow';
import { partnerA, partnerC, partnerX } from '../fixtures/context-fixtures/partner-fixtures';
import { IdentityProviderService } from 'api/src/auth/login/identity-provider.service';
import { Logger } from '@nestjs/common';
import sessionStore from '../helpers/session/session-store';
import { sidFromCookie } from '../helpers/session/session-cookie';

describe('Authentication', () => {
  describe('Login redirect', () => {
    const endpoint = '/auth/login';
    it('should redirect the user to the appropriate IdP based on the origin', async () => {
      const resA = await request(app.getHttpServer()).get(endpoint).query({ origin: idpA.feHome });
      const resX = await request(app.getHttpServer()).get(endpoint).query({ origin: idpX.feHome });

      expect(resA.status).toBe(302);
      expect(resX.status).toBe(302);

      expect(resA.headers.location).toContain(oidcConfigA.issuer);
      expect(resX.headers.location).toContain(oidcConfigX.issuer);
    });

    it('should respond with a 400 on an unrecognized origin', async () => {
      const res = await request(app.getHttpServer())
        .get(endpoint)
        .query({ origin: 'http://unrecognized.com' });
      expect(res.status).toBe(400);
    });

    it('should respond with a 400 on a missing origin', async () => {
      const res = await request(app.getHttpServer()).get(endpoint);
      expect(res.status).toBe(400);
    });
  });

  describe('Successful Auth', () => {
    describe('Existing users, existing tenants', () => {
      it('should accept valid login attempts from UM-like IdPs (embedded claims)', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker.authUserInTenant(userA, tenantA).addRoles(idpA.oidcConfig.requiredRoles[0]);
        const { getSessionFromDB } = await completeAuth('pass');

        const session = await getSessionFromDB();
        expect(session?.passport?.user.tenant.code).toBe(tenantA.code);
        expect(session?.passport?.user.tenant.partnerId).toBe(partnerA.id);
        expect(session?.passport?.user.user.email).toBe(userA.email);
      });

      it('should accept valid login attempts from EdGraph-like IdPs (top level claims)', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpX);
        claimsMocker.authUserInTenant(userX, tenantX).addRoles(idpX.oidcConfig.requiredRoles[0]);
        const { getSessionFromDB } = await completeAuth('pass');

        const session = await getSessionFromDB();
        expect(session?.passport?.user.tenant.code).toBe(tenantX.code);
        expect(session?.passport?.user.tenant.partnerId).toBe(partnerX.id);
        expect(session?.passport?.user.user.email).toBe(userX.email);
      });

      it('should not require a partner claim for IdPs used by a single partner (EdGraph-like IdP)', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpX);
        claimsMocker
          .authUserInTenant(userX, { code: tenantX.code }) // no partner claim
          .addRoles(idpX.oidcConfig.requiredRoles[0]);
        const { getSessionFromDB } = await completeAuth('pass');

        const session = await getSessionFromDB();
        expect(session?.passport?.user.tenant.partnerId).toBe(partnerX.id);
        expect(session?.passport?.user.tenant.code).toBe(tenantX.code);
        expect(session?.passport?.user.user.email).toBe(userX.email);
      });
    });
    describe('Existing users, new tenants', () => {
      it('should create a new tenant on the fly associated with the partner from the partner claim in the token (UM-like IdP)', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker
          .authUserInTenant(userA, { code: 'new-a' }) // partner not included here
          .addRoles(idpA.oidcConfig.requiredRoles[0])
          .addClaims({ [idpA.oidcConfig.partnerClaim!]: partnerA.id }); // add explicit partner claim

        const { getSessionFromDB } = await completeAuth('pass');

        const session = await getSessionFromDB();
        expect(session?.passport?.user.tenant.code).toBe('new-a');
        expect(session?.passport?.user.tenant.partnerId).toBe(partnerA.id);
        expect(session?.passport?.user.user.email).toBe(userA.email);

        const tenants = await prisma.tenant.findMany({
          where: {
            code: 'new-a',
          },
        });
        try {
          expect(tenants.length).toBe(1);
          expect(tenants[0].partnerId).toBe(partnerA.id);
          const users = await prisma.user.findMany({
            where: {
              email: userA.email,
            },
          });
          expect(users.length).toBe(1);
        } finally {
          await prisma.tenant.deleteMany({
            where: {
              code: 'new-a',
            },
          });
        }
      });

      it("should create a new tenant on the fly associated with the IdP's sole partner (EdGraph-like IdP)", async () => {
        // There is no explicit partner claim with EdGraph. idpX has one partner and that's the one that is used
        const { claimsMocker, completeAuth } = await initiateAuth(idpX);
        claimsMocker
          .authUserInTenant(userX, { code: 'new-x' }) // partner not included here
          .addRoles(idpX.oidcConfig.requiredRoles[0]); // no partner claim
        const { getSessionFromDB } = await completeAuth('pass');

        const session = await getSessionFromDB();
        expect(session?.passport?.user.tenant.code).toBe('new-x');
        expect(session?.passport?.user.tenant.partnerId).toBe(partnerX.id);
        expect(session?.passport?.user.user.email).toBe(userX.email);

        const tenants = await prisma.tenant.findMany({
          where: {
            code: 'new-x',
          },
        });
        try {
          expect(tenants.length).toBe(1);
          expect(tenants[0].partnerId).toBe(partnerX.id); // partnerX is the sole user of idpX
          const users = await prisma.user.findMany({
            where: {
              email: userX.email,
            },
          });
          expect(users.length).toBe(1);
        } finally {
          await prisma.tenant.deleteMany({
            where: {
              code: 'new-x',
            },
          });
        }
      });
    });
    describe('New user, existing tenant', () => {
      // This is the same between UM-like and EdGraph-like IdPs since users are IdP-scoped
      it('should create a new user on the fly associated with the IdP', async () => {
        const newUser = {
          email: 'new-user-a@test.com',
          givenName: 'newFirstA',
          familyName: 'newLastA',
        };
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker.authUserInTenant(newUser, tenantA).addRoles(idpA.oidcConfig.requiredRoles[0]);
        await completeAuth('pass');

        const users = await prisma.user.findMany({
          where: {
            email: newUser.email,
          },
        });
        try {
          expect(users.length).toBe(1);
          expect(users[0]).toMatchObject(newUser);
          expect(users[0].idpId).toBe(idpA.id);
        } finally {
          await prisma.user.deleteMany({
            where: {
              email: newUser.email,
            },
          });
        }
      });
    });
    describe('New users, new tenants', () => {
      it('should create a new user and new tenant on the fly (UM-like IdP)', async () => {
        const newUser = {
          email: 'new-user-a@test.com',
          givenName: 'newFirstA',
          familyName: 'newLastA',
        };
        const newTenant = {
          code: 'new-a',
        };
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker
          .authUserInTenant(newUser, newTenant) // no partner id
          .addRoles(idpA.oidcConfig.requiredRoles[0])
          .addClaims({ [idpA.oidcConfig.partnerClaim!]: partnerA.id }); // add explicit partner claim
        await completeAuth('pass');

        const users = await prisma.user.findMany({
          where: {
            email: newUser.email,
          },
        });
        expect(users.length).toBe(1);
        expect(users[0]).toMatchObject(newUser);
        expect(users[0].idpId).toBe(idpA.id);

        const tenants = await prisma.tenant.findMany({
          where: {
            code: newTenant.code,
          },
        });
        expect(tenants.length).toBe(1);
        expect(tenants[0].partnerId).toBe(partnerA.id); // matches claim
        expect(tenants[0].code).toBe(newTenant.code);

        await Promise.all([
          prisma.user.deleteMany({
            where: {
              email: newUser.email,
            },
          }),
          prisma.tenant.deleteMany({
            where: {
              code: newTenant.code,
            },
          }),
        ]);
      });

      it('should create a new user and new tenant on the fly (EdGraph-like IdP)', async () => {
        const newUser = {
          email: 'new-user-x@test.com',
          givenName: 'newFirstX',
          familyName: 'newLastX',
        };
        const newTenant = {
          code: 'new-x',
        };
        const { claimsMocker, completeAuth } = await initiateAuth(idpX);
        claimsMocker
          .authUserInTenant(newUser, newTenant) // no partner id
          .addRoles(idpX.oidcConfig.requiredRoles[0]); // no partner claim
        await completeAuth('pass');

        const user = await prisma.user.findMany({
          where: {
            email: newUser.email,
          },
        });
        expect(user.length).toBe(1);
        expect(user[0]).toMatchObject(newUser);
        expect(user[0].idpId).toBe(idpX.id);

        const tenants = await prisma.tenant.findMany({
          where: {
            code: newTenant.code,
          },
        });
        expect(tenants.length).toBe(1);
        expect(tenants[0].partnerId).toBe(partnerX.id); // partnerX is the sole user of idpX
        expect(tenants[0].code).toBe(newTenant.code);

        await Promise.all([
          prisma.user.deleteMany({
            where: {
              email: newUser.email,
            },
          }),
          prisma.tenant.deleteMany({
            where: {
              code: newTenant.code,
            },
          }),
        ]);
      });
    });

    describe('Shared emails and tenant codes across IdPs', () => {
      it('should allow Person A to authenticate through IdP X and will create a new user record associated with the IdP X', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpX);
        const personA = {
          email: userA.email,
          givenName: userA.givenName,
          familyName: userA.familyName,
        };
        claimsMocker.authUserInTenant(personA, tenantX).addRoles(idpX.oidcConfig.requiredRoles[0]);
        await completeAuth('pass');

        const users = await prisma.user.findMany({
          where: {
            email: userA.email,
          },
          orderBy: { createdOn: 'asc' },
        });
        try {
          expect(users.length).toBe(2);
          users.forEach((user) => expect(user).toMatchObject(personA));
          expect(users[0].idpId).toBe(idpA.id);
          expect(users[1].idpId).toBe(idpX.id);
        } finally {
          // Delete the user created by this test (associated with idpX), leave seeded userA in place
          await prisma.user.deleteMany({ where: { email: userA.email, idpId: idpX.id } });
        }
      });

      it('should allow tenant codes to be reused across IdPs and will create new tenant records', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker
          .authUserInTenant(userA, { code: tenantX.code })
          .addRoles(idpA.oidcConfig.requiredRoles[0])
          .addClaims({ [idpA.oidcConfig.partnerClaim!]: partnerA.id }); // add explicit partner claim
        await completeAuth('pass');

        const tenants = await prisma.tenant.findMany({
          where: {
            code: tenantX.code,
          },
          include: { userTenant: { include: { user: true } } },
          orderBy: { createdOn: 'asc' },
        });
        try {
          expect(tenants.length).toBe(2);

          // existing tenantX should not be associated with userA or partnerA
          expect(tenants[0].partnerId).toBe(tenantX.partnerId); // confirm it's original tenantX
          const userIdsInXX = tenants[0].userTenant.map((ut) => ut.user.id);
          expect(userIdsInXX).not.toContain(userA.id);

          // new tenant should be associated with userA and partnerA
          expect(tenants[1].partnerId).toBe(partnerA.id); // matches claim
          const userIdsInA = tenants[1].userTenant.map((ut) => ut.user.id);
          expect(userIdsInA).toContain(userA.id);
        } finally {
          await prisma.tenant.delete({
            where: { code_partnerId: { code: tenantX.code, partnerId: partnerA.id } },
          });
        }
      });
    });

    describe('Multiple partners using the same IdP', () => {
      // These test cases could fit into the above describe blocks, but I find separating them
      // out makes it easier to see all the expectations for how multi-partner IdPs should work.
      // All the above stuff for "UM-like IdPs" still applies.
      it('should allow users to log into tenants associated with different partners using the same IdP', async () => {
        const authA = await initiateAuth(idpA);
        authA.claimsMocker
          .authUserInTenant(userA, tenantA)
          .addRoles(idpA.oidcConfig.requiredRoles[0]);
        const { getSessionFromDB: getSessionA } = await authA.completeAuth('pass');

        const sessionA = await getSessionA();
        expect(sessionA?.passport?.user.tenant.code).toBe(tenantA.code);
        expect(sessionA?.passport?.user.tenant.partnerId).toBe(partnerA.id);
        expect(sessionA?.passport?.user.user.email).toBe(userA.email);

        const authC = await initiateAuth(idpA);
        authC.claimsMocker
          .authUserInTenant(userB, tenantC) // IdPA, will have partner-c claim
          .addRoles(idpA.oidcConfig.requiredRoles[0]);
        const { getSessionFromDB: getSessionC } = await authC.completeAuth('pass');

        const sessionC = await getSessionC();
        expect(sessionC?.passport?.user.tenant.code).toBe(tenantC.code);
        expect(sessionC?.passport?.user.tenant.partnerId).toBe(partnerC.id);
        expect(sessionC?.passport?.user.user.email).toBe(userB.email);
      });

      it('should reject logins if the partner in the claim is not associated with the IdP', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker
          .authUserInTenant(userA, tenantA)
          .addRoles(idpA.oidcConfig.requiredRoles[0])
          .addClaims({ [idpA.oidcConfig.partnerClaim!]: partnerX.id }); // partnerX is not associated with idpA
        await completeAuth('fail');
      });

      it('should segment tenant codes by partner within the same IdP', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker
          .authUserInTenant(userA, { code: tenantA.code }) // same code as tenantA in partnerA
          .addRoles(idpA.oidcConfig.requiredRoles[0])
          .addClaims({ [idpA.oidcConfig.partnerClaim!]: partnerC.id }); // but coming through with a partnerC claim
        const { getSessionFromDB } = await completeAuth('pass');

        const sessionA = await getSessionFromDB();
        expect(sessionA?.passport?.user.tenant.code).toBe(tenantA.code);
        expect(sessionA?.passport?.user.tenant.partnerId).toBe(partnerC.id);
        expect(sessionA?.passport?.user.user.email).toBe(userA.email);

        const tenants = await prisma.tenant.findMany({
          where: {
            code: tenantA.code,
          },
          orderBy: { createdOn: 'asc' },
        });
        try {
          expect(tenants.length).toBe(2);
          expect(tenants[0].partnerId).toBe(partnerA.id);
          expect(tenants[1].partnerId).toBe(partnerC.id);
        } finally {
          await prisma.tenant.delete({
            where: { code_partnerId: { code: tenantA.code, partnerId: partnerC.id } },
          });
        }
      });

      it('should reuse a user record across partners that use the same IdP', async () => {
        // log into a parter A tenant
        const authA = await initiateAuth(idpA);
        authA.claimsMocker
          .authUserInTenant(userA, tenantA)
          .addRoles(idpA.oidcConfig.requiredRoles[0]);
        await authA.completeAuth('pass');

        // log into a parter C tenant
        const authC = await initiateAuth(idpA);
        authC.claimsMocker
          .authUserInTenant(userA, tenantC)
          .addRoles(idpA.oidcConfig.requiredRoles[0]);
        await authC.completeAuth('pass');

        const users = await prisma.user.findMany({
          where: {
            email: userA.email,
          },
        });
        expect(users.length).toBe(1);
        expect(users[0].idpId).toBe(idpA.id);
      });
    });
  });

  describe('Token interpretation', () => {
    describe('Role requirement', () => {
      it('should reject users with no assigned role', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker.authUserInTenant(userA, tenantA);
        await completeAuth('fail');
      });

      it('should reject users with an invalid role', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker.authUserInTenant(userA, tenantA).addRoles(['not-a-valid-role']);
        await completeAuth('fail');
      });

      it('should have different role requirements for different IdPs', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker.authUserInTenant(userA, tenantA).addRoles(idpX.oidcConfig.requiredRoles[0]); // role accepted by idpX, not idpA
        await completeAuth('fail');
      });
      it('should require only one valid role', async () => {
        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker
          .authUserInTenant(userA, tenantA)
          .addRoles(['not-a-valid-role', 'not-a-valid-role-2', idpA.oidcConfig.requiredRoles[0]]);
        await completeAuth('pass');
      });
    });
    describe('Partner requirement', () => {
      it('should reject logins if partner claim is required but not provided (UM-like IdP)', async () => {
        expect(idpA.oidcConfig.partnerClaim).toBeDefined(); // double check that the partner claim is actually required

        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker
          .authUserInTenant(userA, tenantA)
          .addRoles(idpA.oidcConfig.requiredRoles[0])
          .addClaims({
            [idpA.oidcConfig.partnerClaim!]: null,
          });
        await completeAuth('fail');
      });

      it('should reject logins if partner claim is provided but does not match the IdP partner', async () => {
        expect(idpA.oidcConfig.partnerClaim).toBeDefined(); // double check that the partner claim is actually required

        const { claimsMocker, completeAuth } = await initiateAuth(idpA);
        claimsMocker
          .authUserInTenant(userA, tenantA)
          .addRoles(idpA.oidcConfig.requiredRoles[0])
          .addClaims({
            [idpA.oidcConfig.partnerClaim!]: partnerX.id, // partner for the other IdP
          });
        await completeAuth('fail');
      });

      it('should allow login without a partner claim (EdGraph-like IdP) but only to tenants associated with IdP/partner', async () => {
        expect(idpX.oidcConfig.partnerClaim).toBeNull(); // if partner claim location not specified, it won't be included in token

        // NOTE: this test is duplicative of earlier tests for login via EdGraph-like IdPs.
        // I'm including it here in case those other tests shift in focus
        const { claimsMocker, completeAuth } = await initiateAuth(idpX);
        claimsMocker.authUserInTenant(userX, tenantX).addRoles(idpX.oidcConfig.requiredRoles[0]);
        await completeAuth('pass');
      });
    });
  });

  describe('Misconfiguration', () => {
    it('should not register a multi-partner IdP without a partner claim', async () => {
      const idpService = app.get(IdentityProviderService);
      const originalConfig = await prisma.oidcConfig.findUniqueOrThrow({
        where: {
          id: idpA.oidcConfig.id,
        },
      });

      // remove the partner claim to introduce bad config (given that it's used by partners A and C)
      await prisma.oidcConfig.update({
        where: {
          id: originalConfig.id,
        },
        data: {
          partnerClaim: null,
        },
      });

      const loggerSpy = jest.spyOn(Logger.prototype, 'error');
      const registrationSpy = jest.spyOn(idpService as any, 'registerOidcIdp'); // spy on the private method
      await idpService.onApplicationBootstrap();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        `${idpA.id} does not have a partner claim but is used by ${partnerA.id}, ${partnerC.id}. Users for these partners will not be able to log in until this is fixed.`
      );
      expect(registrationSpy).toHaveBeenCalledTimes(1); // once for IdPX
      // expect(idpService.idpRegistrationForId(idpA.id)).toBeUndefined(); // This check doesn't work since the earlier registation is still around
      loggerSpy.mockClear();
      registrationSpy.mockClear();

      await prisma.oidcConfig.update({
        where: {
          id: originalConfig.id,
        },
        data: {
          partnerClaim: originalConfig.partnerClaim,
        },
      });
      // No need to reset since the original registration was not overwritten
      // await idpService.onApplicationBootstrap(); // restore for other tests
      // expect(idpService.idpRegistrationForId(idpA.id)).toBeDefined();
    });
  });

  describe('Logout', () => {
    let cookieA: string;
    beforeEach(async () => {
      // Tests must perform logout on their own
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
    });

    it('should destroy the session and include the end session URL in the response header', async () => {
      const sessionBefore = await sessionStore.get(sidFromCookie(cookieA));
      expect(sessionBefore).toBeDefined();
      expect(sessionBefore?.passport?.user.idToken).toBeDefined();

      const res = await request(app.getHttpServer()).post('/auth/logout').set('Cookie', [cookieA]);
      expect(res.status).toBe(200);
      const redirectUrl = new URL(decodeURI(res.headers['location']));
      expect(redirectUrl.href).toContain(`${idpA.oidcConfig.issuer}/end_session_endpoint`); // from our mock OIDC provider

      expect(redirectUrl.searchParams.get('post_logout_redirect_uri')).toBe(idpA.feHome);
      expect(redirectUrl.searchParams.get('id_token_hint')).toBe(
        sessionBefore?.passport?.user.idToken
      );

      const sessionAfter = await sessionStore.get(sidFromCookie(cookieA));
      expect(sessionAfter).toBeUndefined();
    });

    it('should use logout_hint if id_token_hint is too large', async () => {
      const sessionBefore = await sessionStore.get(sidFromCookie(cookieA));
      expect(sessionBefore?.passport?.user.idpSessionId?.length).toBeGreaterThan(0);
      expect(sessionBefore?.passport?.user.idToken?.length).toBeGreaterThan(0);

      const largeIdToken = 'a'.repeat(1024 * 3 + 1); // 3KB + 1 byte
      sessionBefore!.passport!.user.idToken = largeIdToken;
      await sessionStore.set(sidFromCookie(cookieA), sessionBefore!);

      const res = await request(app.getHttpServer()).post('/auth/logout').set('Cookie', [cookieA]);
      expect(res.status).toBe(200);
      const redirectUrl = new URL(decodeURI(res.headers['location']));
      expect(redirectUrl.href).toContain(`${idpA.oidcConfig.issuer}/end_session_endpoint`); // from our mock OIDC provider
      expect(redirectUrl.searchParams.get('logout_hint')).toBe(
        sessionBefore?.passport?.user.idpSessionId
      );
      expect(redirectUrl.searchParams.get('id_token_hint')).toBeNull();

      const sessionAfter = await sessionStore.get(sidFromCookie(cookieA));
      expect(sessionAfter).toBeUndefined();
    });
  });
});
