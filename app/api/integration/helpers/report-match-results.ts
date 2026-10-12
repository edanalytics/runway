import request from 'supertest';
import { EarthbeamApiAuthService } from 'api/src/earthbeam/api/auth/earthbeam-api-auth.service';

/** Report match results for a run the way the Executor does. */
export const reportMatchResults = async (runId: number, body: unknown[]) => {
  const token = await app.get(EarthbeamApiAuthService).createAccessToken({ runId });
  const res = await request(app.getHttpServer())
    .post(`/earthbeam/jobs/${runId}/student-match-results`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
};
