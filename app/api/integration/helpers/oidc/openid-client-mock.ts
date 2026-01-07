import { IdpFixture } from 'api/integration/fixtures/context-fixtures/idp-fixtures';
import { merge, set } from 'lodash';
import { ClientMetadata, Issuer, TokenSet, UserinfoResponse } from 'openid-client';

/**
 * This mock allows us to simulate OIDC login flows. Here's how it works:
 *
 * - Call `prepareMockOIDC` when bootstrapping the test app instance. When the
 *   app bootstraps, it pulls IdPs from the DB, creates a client for each, and
 *   registers a passport strategy that uses that client. Calling `prepareMockOIDC`
 *   mocks Issuer.discover so (A) we don't actually attempt to contact the IdP
 *   (which cound introduce test flakiness) and (B) we give the passport strategy
 *   a mock client, via which tests can pass mock claims to the strategy.
 * - In tests, configure the claims you want to pass to the passport strategy.
 *   To do this, you'll need to retrieve the ClaimsMocker instance that's used by
 *   the mock OIDC client that the passport strategy you're authing through uses.
 *     - Call `getClaimsMocker` to retrieve the ClaimsMocker instance.
 *     - Use the various methods to mock claims for an auth flow.
 *     - Reset the mocker between tests (or call `getClaimsMocker`, which also handles the reset)
 *
 * Note that this approach simulates the app behavior of having a separate OIDC client
 * per IdP and allows us to mock claims for each independently. There is some
 * value in that (e.g. you can have userA log in through IdPA and userX log in through IdPX),
 * but limited. After all, each mocker can only handle one session at a time, so
 * mocking userA and userB logging in through IdPA would require extra coordination
 * in the test.
 *
 * A final note...
 * We need to be careful not to mock too much here. We're not mocking any of the
 * passport strategy or the validation function used by the strategy. And, to the extent
 * we can, we're using the real Issuer and Client code from the openid-client.
 */
const claimsMockers = new Map<string, ClaimsMocker>();
export const getClaimsMocker = (issuer: string) => {
  const key = issuer.split('/authorization_endpoint')[0];
  const claimsMocker = claimsMockers.get(key);
  if (!claimsMocker) {
    throw new Error(`No mock found for issuer URL: ${issuer}`);
  }
  return claimsMocker.reset();
};

export const prepareMockOIDC = () => {
  jest.spyOn(Issuer, 'discover').mockImplementation(async (wellKnownEndpoint: string) => {
    const issuerUrl = wellKnownEndpoint.split('/.well-known/openid-configuration')[0];
    const issuer = new Issuer({
      issuer: wellKnownEndpoint,
      authorization_endpoint: `${issuerUrl}/authorization_endpoint`,
      token_endpoint: `${issuerUrl}/token_endpoint`,
      userinfo_endpoint: `${issuerUrl}/userinfo_endpoint`,
      end_session_endpoint: `${issuerUrl}/end_session_endpoint`,
      jwks_uri: `${issuerUrl}/jwks`,
    });
    const claimsMocker = new ClaimsMocker();
    claimsMockers.set(issuerUrl, claimsMocker);

    /**
     * MockClient is implemented in this odd way, built at runtime within another
     * mock, due to a few constraints:
     * 1. If MockClient is not an instance of BaseClient, it cannot be used
     *    in the Passport strategy, which does an instanceof check.
     * 2. However, BaseClient is exported only in index.d.ts, not in index.js. You can
     *    use it to type things, but it's not available at runtime to instantiate or mock.
     * 3. The Client constructor is not available at Issuer.prototype.Client, even
     *    though the Issuer type definition indicates that it is. Rather, the Client
     *    constructor is added as an instance property when Issuer is instantiated.
     *    https://github.com/panva/openid-client/blob/45c96f67ce0644bd829f61e82fba3dd8c051c89e/lib/issuer.js#L74
     */
    class MockClient extends issuer.Client {
      constructor(metadata: ClientMetadata) {
        super(metadata);
      }

      async callback() {
        // Normally, this function would retrieve data from the IdP, but here we're just mocking it
        // based on the claims that were set up in the test
        return new TokenSet({
          access_token: 'test-access-token', // if not present, the strategy will throw rather than attemp to hit the userinfo endpoint
          id_token: `header.${Buffer.from(
            JSON.stringify(claimsMocker.getClaims()),
            'utf8'
          ).toString('base64')}.signature`,
        });
      }

      async userinfo(token: TokenSet | string): Promise<UserinfoResponse<any, any>> {
        // This is a no-op to prevent the openid-client from attempting to hit the userinfo endpoint.
        // Any claims that come back from this endpoint are merged with the ID token claims in the
        // strategy so we don't bother to add any here.
        return;
      }
    }

    return {
      Client: MockClient,
      metadata: issuer.metadata,
    } as unknown as Issuer; //  Issuer.Client is readonly, so we pass our mock in a new object rather than modifying the original
  });

  return claimsMockers;
};

type UserInfo = {
  email: string | null;
  givenName: string | null;
  familyName: string | null;
};

type TenantInfo = {
  code: string;
  partnerId?: string;
};

class ClaimsMocker {
  private additionalClaims: Record<string, any> = {};
  private idp: IdpFixture | undefined;
  private user: UserInfo | undefined;
  private tenant: TenantInfo | undefined;
  private roles: string[] = [];
  private sid: string | undefined;

  reset() {
    this.idp = undefined; // determines how the claims are structured
    this.resetAuth();
    return this;
  }

  resetAuth() {
    // leave IdP in place but clear the rest
    this.additionalClaims = {};
    this.roles = [];
    this.user = undefined;
    this.tenant = undefined;
    this.sid = undefined;
    return this;
  }

  // Need the test to supply the IdP fixture since we don't have access to
  // it from within the Issuer.discover mock when we instantiate the MockIdp
  configure(idp: IdpFixture) {
    this.idp = idp;
  }

  authUserInTenant<TUser extends UserInfo, TTenant extends TenantInfo>(
    user: TUser,
    tenant: TTenant
  ) {
    this.resetAuth();
    this.user = user;
    this.tenant = tenant;
    this.roles = [];
    this.additionalClaims = {};
    this.sid = `${user.email}-${tenant.code}-${Date.now()}`;
    return this;
  }

  addRoles(role: string | string[]) {
    if (!this.idp || !this.user || !this.tenant) {
      throw new Error('IdP, user, or tenant not configured');
    }

    if (Array.isArray(role)) {
      this.roles.push(...role);
    } else {
      this.roles.push(role);
    }
    return this;
  }

  addClaims(claims: Record<string, any>) {
    if (!this.idp || !this.user || !this.tenant) {
      throw new Error('IdP, user, or tenant not configured');
    }

    // key can be of the form 'a.b.c' so we need to transform to a nested object and then merge
    const nestedClaims = {};
    Object.keys(claims).forEach((key) => {
      set(nestedClaims, key, claims[key]);
    });

    this.additionalClaims = merge(this.additionalClaims, nestedClaims);
    return this;
  }

  getClaims() {
    if (!this.idp || !this.user || !this.tenant) {
      throw new Error('IdP, user, or tenant not configured');
    }

    // always available directly on the ID token, whether or not there are also embedded claims
    const claims = {
      given_name: this.user.givenName,
      family_name: this.user.familyName,
      email: this.user.email,
      sid: this.sid,
    };

    const otherClaims = {};
    set(otherClaims, this.idp.oidcConfig.userIdClaim, this.user.email);
    set(otherClaims, this.idp.oidcConfig.tenantCodeClaim, this.tenant.code);
    if (this.idp.oidcConfig.partnerClaim && this.tenant.partnerId) {
      // TODO: Consider making the partner claim something that must be explicitly set by callers
      // rather than implicitly set given presence of partner claim and a partner id on the tenant
      set(otherClaims, this.idp.oidcConfig.partnerClaim, this.tenant.partnerId);
    }
    if (this.idp.oidcConfig.requireRole) {
      set(otherClaims, this.idp.oidcConfig.rolesClaim!, this.roles);
    }

    merge(otherClaims, this.additionalClaims); // allow claims added with addClaims to override any others
    if (this.idp.oidcConfig.embeddedClaimsClaim) {
      set(claims, this.idp.oidcConfig.embeddedClaimsClaim, JSON.stringify(otherClaims));
    } else {
      merge(claims, otherClaims);
    }

    return claims;
  }
}
