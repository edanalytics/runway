import { OdsConfig, OdsConnection, Job } from '@prisma/client';
import { JWTPayload } from 'jose';

/** Token payload for external API requests. Extends JWTPayload with required scope. */
export type ExternalApiTokenPayload = JWTPayload & { scope: string };

declare global {
  namespace Express {
    interface Request {
      odsConfig?: OdsConfig & { activeConnection: OdsConnection };
      job?: Job;
      tokenPayload?: ExternalApiTokenPayload;
    }
  }
}
