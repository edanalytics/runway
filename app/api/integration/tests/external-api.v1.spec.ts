import request from 'supertest';
import { signExternalApiToken } from '../helpers/external-api/token-helper';
import * as jose from 'jose';
import { EXTERNAL_API_SCOPE_KEY } from '../../src/external-api/auth/external-api-scope.decorator';
import { ExternalApiV1TokenController } from '../../src/external-api/v1/token.v1.controller';

describe('ExternalApiV1', () => {
  describe('Token Auth', () => {
    const endpoint = '/v1/token/verify';
    const scope = ['create:jobs', 'partner:partner-a'].join(' ');

    describe('Valid Token', () => {
      it('should return 201 if the token is valid', async () => {
        const token = await signExternalApiToken({ scope });
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(201);
      });
    });
    describe('Invalid Token', () => {
      it('should return 401 if there is no token', async () => {
        const res = await request(app.getHttpServer()).post(endpoint).set('Authorization', '');
        expect(res.status).toBe(401);
      });

      it('should return 401 if the payload is tampered with', async () => {
        const token = await signExternalApiToken({ scope });
        const [header, payload, signature] = token.split('.');
        const invalidPayload = {
          ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
          scope: 'create:jobs:invalid',
        };
        const invalidToken = `${header}.${Buffer.from(JSON.stringify(invalidPayload)).toString(
          'base64url'
        )}.${signature}`;
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${invalidToken}`);
        expect(res.status).toBe(401);
      });

      it('should return 401 if the token signature is invalid', async () => {
        const token = await signExternalApiToken({ scope });
        const [header, payload, signature] = token.split('.');
        const invalidToken = `${header}.${payload}.invalid`;
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${invalidToken}`);
        expect(res.status).toBe(401);
      });

      it('should return 401 if the token is not signed with the correct keys', async () => {
        const newKeyPair = await jose.generateKeyPair('RS256');
        const token = await signExternalApiToken(
          { scope },
          { privateKey: newKeyPair.privateKey } // signing the token with this new private key means it can't be verified with the public key jose is using
        );
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });

      it('should return 401 if the audience is invalid', async () => {
        const token = await signExternalApiToken({ scope }, { audience: 'invalid' });
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });
      it('should return 401 if the token is expired', async () => {
        const token = await signExternalApiToken({ scope }, { expiresIn: '-1s' }); // you can sign expired tokens!
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
      });
      it('should return 403 if required scope is missing', async () => {
        const token = await signExternalApiToken({
          scope: scope.replace('create:jobs', '').trim(),
        }); // no create:jobs scope
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });
      it('should return 403 if ANY required scope is missing', async () => {
        const token = await signExternalApiToken({ scope }); // has create:jobs but not read:jobs
        const originalScopes = Reflect.getMetadata(
          EXTERNAL_API_SCOPE_KEY,
          ExternalApiV1TokenController.prototype.verifyToken
        );
        try {
          Reflect.defineMetadata(
            EXTERNAL_API_SCOPE_KEY,
            ['create:jobs', 'read:jobs'], // require both
            ExternalApiV1TokenController.prototype.verifyToken
          );

          const res = await request(app.getHttpServer())
            .post(endpoint)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(403);
        } finally {
          // restore original scopes
          Reflect.defineMetadata(
            EXTERNAL_API_SCOPE_KEY,
            originalScopes,
            ExternalApiV1TokenController.prototype.verifyToken
          );
        }
      });
      it('should return 403 if scopes are not included on the token', async () => {
        const token = await signExternalApiToken({});
        const res = await request(app.getHttpServer())
          .post(endpoint)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
      });
    });
  });
});
