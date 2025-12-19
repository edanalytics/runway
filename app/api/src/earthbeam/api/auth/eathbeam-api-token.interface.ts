import { Run } from '@prisma/client';

export interface IEarthbeamTokenPayload {
  runId: Run['id'];
  type: 'init' | 'access';
}
