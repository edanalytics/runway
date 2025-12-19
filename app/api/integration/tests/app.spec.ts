import request from 'supertest';

describe('GET /healthcheck', () => {
  it('should return a message', async () => {
    const res = await request(app.getHttpServer()).get('/healthcheck').expect(200);
    expect(res.text).toBe("Feelin' great!");
  });
});
