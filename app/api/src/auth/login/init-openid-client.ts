import { Logger } from '@nestjs/common';
import { OidcConfig } from '@prisma/client';
import { Issuer, Client } from 'openid-client';

const logger = new Logger('InitOpenidClient');

/**
 * Single-attempt OIDC issuer discovery + client creation.
 * Callers are responsible for retry logic.
 */
export const initOpenidClient = async (config: OidcConfig) => {
  try {
    const TrustIssuer = await Issuer.discover(
      `${config.issuer}/.well-known/openid-configuration`
    );
    return {
      status: 'SUCCESS' as const,
      client: new TrustIssuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    };
  } catch (e) {
    logger.error(`Failed to contact OIDC issuer: ${config.id}. ${e}`);
    return { status: 'FAILURE' as const };
  }
};
