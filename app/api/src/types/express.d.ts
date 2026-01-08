import { OdsConfig, OdsConnection, Job } from '@prisma/client';
import { ExternalApiTokenPayload } from '../external-api/external-api-token.guard';

declare global {
  namespace Express {
    interface Request {
      odsConfig?: OdsConfig & { activeConnection: OdsConnection };
      job?: Job;
      tokenPayload?: ExternalApiTokenPayload;
    }
  }
}
