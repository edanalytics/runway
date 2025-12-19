import axios from 'axios';

describe('GET /api', () => {
  it('should return a message', async () => {
    const res = await axios.get(`/api/healthcheck`);

    expect(res.status).toBe(200);
    expect(res.data).toBe("Feelin' great!");
  });
});
