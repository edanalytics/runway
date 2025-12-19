import { OdsConfig, OdsConnection, Job } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      odsConfig?: OdsConfig & { activeConnection: OdsConnection };
      job?: Job;
    }
  }
}
