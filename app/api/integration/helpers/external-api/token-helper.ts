import * as jose from 'jose';

let privateKey: jose.KeyLike;
let localJWKS: ReturnType<typeof jose.createLocalJWKSet>;
let initialized = false;

export async function initExternalApiTokenMock() {
  if (initialized) return;

  const keyPair = await jose.generateKeyPair('RS256');
  privateKey = keyPair.privateKey;

  const publicJwk = await jose.exportJWK(keyPair.publicKey);
  publicJwk.kid = 'test-key-1'; // identify this as a test key
  localJWKS = jose.createLocalJWKSet({ keys: [publicJwk] });

  initialized = true;
}

export function getLocalJWKS() {
  if (!initialized) throw new Error('Call initExternalApiTokenMock first');
  return localJWKS;
}

const TEST_AUDIENCE = process.env.OAUTH2_AUDIENCE ?? 'test-audience';

export const TEST_ISSUER = 'https://test-issuer.example.com';

export async function signExternalApiToken(
  payload: jose.JWTPayload,
  options?: { expiresIn?: string; audience?: string; privateKey?: jose.KeyLike; issuer?: string } // use these to produce various flavors of invalid tokens
) {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuedAt()
    .setIssuer(options?.issuer ?? TEST_ISSUER)
    .setAudience(options?.audience ?? TEST_AUDIENCE)
    .setExpirationTime(options?.expiresIn ?? '1h')
    .sign(options?.privateKey ?? privateKey);
}
