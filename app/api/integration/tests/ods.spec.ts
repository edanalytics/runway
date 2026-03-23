import request from 'supertest';
import { userA, userB } from '../fixtures/user-fixtures';
import { tenantA, tenantB } from '../fixtures/context-fixtures/tenant-fixtures';
import { authHelper } from '../helpers/oidc/auth-flow';
import { idpA } from '../fixtures/context-fixtures/idp-fixtures';
import { GetOdsConfigDto } from 'models/src/dtos/ods-config.dto';
import {
  odsConfigA2425,
  odsConfigA2526,
  odsConfigB2526,
} from '../fixtures/context-fixtures/ods-fixture';
import { schoolYear2324, schoolYear2425, schoolYear2526 } from '../fixtures/context-fixtures/school-year-fixtures';
import { EdfiService } from '../../src/edfi/edfi.service';

describe('GET /ods-configs', () => {
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get('/ods-configs');
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    let cookieB: string;
    const expectedOdsA = [odsConfigA2425, odsConfigA2526];
    const expectedOdsB = [odsConfigB2526];

    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
      cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
    });

    it('should return a list of ods configs for the tenant', async () => {
      const resA = await request(app.getHttpServer()).get('/ods-configs').set('Cookie', [cookieA]);
      const resB = await request(app.getHttpServer()).get('/ods-configs').set('Cookie', [cookieB]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      expect(resA.body.length).toBe(expectedOdsA.length);
      expect(resB.body.length).toBe(expectedOdsB.length);

      const resAIds = resA.body.map((o: GetOdsConfigDto) => o.id);
      expect(resAIds).toEqual(expect.arrayContaining(expectedOdsA.map((o) => o.id)));

      const resBIds = resB.body.map((o: GetOdsConfigDto) => o.id);
      expect(resBIds).toEqual(expect.arrayContaining(expectedOdsB.map((o) => o.id)));
    });
  });
});

describe('GET /ods-configs/:id', () => {
  const endpointA = `/ods-configs/${odsConfigA2425.id}`;
  const endpointB = `/ods-configs/${odsConfigB2526.id}`;
  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(endpointA);
    expect(res.status).toBe(401);
  });
  describe('authenticated requests', () => {
    let cookieA: string;
    let cookieB: string;
    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
      cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
    });

    it('should return the ods config if the user is logged into the associated tenant', async () => {
      const resA = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieA]);
      const resB = await request(app.getHttpServer()).get(endpointB).set('Cookie', [cookieB]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
    });

    it('should reject requests for ODS configs that are not associated with the tenant', async () => {
      // user A requests ODS config B, user B requests ODS config A
      const res1 = await request(app.getHttpServer()).get(endpointA).set('Cookie', [cookieB]);
      const res2 = await request(app.getHttpServer()).get(endpointB).set('Cookie', [cookieA]);
      expect(res1.status).toBe(403);
      expect(res2.status).toBe(403);
    });
  });
});

describe('POST /ods-configs', () => {
  const endpoint = '/ods-configs';

  // schoolYear2324 is not used by any seeded ODS config for tenant A,
  // so it's available for creating a new config without hitting the uniqueness constraint.
  const validInput = {
    host: 'https://new-ods.example.com',
    clientId: 'new-client',
    clientSecret: 'new-secret',
    schoolYearId: schoolYear2324.id,
  };

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).post(endpoint);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    let testConnectionSpy: jest.SpyInstance;

    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
      const edfiService = app.get(EdfiService);
      testConnectionSpy = jest
        .spyOn(edfiService, 'testConnection')
        .mockResolvedValue({ status: 'SUCCESS' });
    });

    afterEach(() => {
      testConnectionSpy.mockRestore();
    });

    it('should create an ODS config and return it', async () => {
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [cookieA])
        .send(validInput);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        host: validInput.host,
        clientId: validInput.clientId,
        schoolYearId: validInput.schoolYearId,
        lastUseResult: 'success',
      });
      expect(res.body.id).toBeDefined();
    });

    it('should test the connection before creating', async () => {
      await request(app.getHttpServer()).post(endpoint).set('Cookie', [cookieA]).send(validInput);

      expect(testConnectionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          host: validInput.host,
          clientId: validInput.clientId,
          clientSecret: validInput.clientSecret,
        })
      );
    });

    it('should reject the request if the connection test fails', async () => {
      testConnectionSpy.mockResolvedValue({ status: 'ERROR', type: 'AUTH' });

      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [cookieA])
        .send(validInput);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Unable to authenticate');
    });

    it('should reject requests with missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [cookieA])
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'EdFi base API URL is required',
          'key is required',
          'secret is required',
          'year is required',
        ])
      );
    });

    it('should reject creating an ODS config for a tenant+partner+year that already has one', async () => {
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Cookie', [cookieA])
        .send({
          ...validInput,
          schoolYearId: schoolYear2425.id,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already exists');
    });
  });
});

describe('PUT /ods-configs/:id', () => {
  const endpoint = `/ods-configs/${odsConfigA2425.id}`;

  const updateInput = {
    host: 'https://updated-ods.example.com',
    clientId: 'updated-client',
    clientSecret: 'updated-secret',
    schoolYearId: schoolYear2425.id,
  };

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).put(endpoint).send(updateInput);
    expect(res.status).toBe(401);
  });

  describe('authenticated requests', () => {
    let cookieA: string;
    let testConnectionSpy: jest.SpyInstance;

    beforeEach(async () => {
      cookieA = (await authHelper.login(idpA, userA, tenantA)).cookies;
      const edfiService = app.get(EdfiService);
      testConnectionSpy = jest
        .spyOn(edfiService, 'testConnection')
        .mockResolvedValue({ status: 'SUCCESS' });
    });

    afterEach(() => {
      testConnectionSpy.mockRestore();
    });

    it('should update an ODS config and return the updated config', async () => {
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [cookieA])
        .send(updateInput);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: odsConfigA2425.id,
        host: updateInput.host,
        clientId: updateInput.clientId,
        schoolYearId: updateInput.schoolYearId,
        lastUseResult: 'success',
      });
    });

    it('should update the school year on the config when changed', async () => {
      // schoolYear2324 is free for tenant A — change from 2425 to 2324
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [cookieA])
        .send({ ...updateInput, schoolYearId: schoolYear2324.id });

      expect(res.status).toBe(200);
      expect(res.body.schoolYearId).toBe(schoolYear2324.id);
    });

    it('should reject updating to a school year that collides with another active config', async () => {
      // odsConfigA2526 already occupies tenant A + schoolYear2526
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [cookieA])
        .send({ ...updateInput, schoolYearId: schoolYear2526.id });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already exists');
    });

    it('should reject requests from a different tenant', async () => {
      const cookieB = (await authHelper.login(idpA, userB, tenantB)).cookies;
      const res = await request(app.getHttpServer())
        .put(endpoint)
        .set('Cookie', [cookieB])
        .send(updateInput);

      expect(res.status).toBe(403);
    });
  });
});
