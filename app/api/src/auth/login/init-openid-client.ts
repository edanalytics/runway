import { wait } from '@edanalytics/utils';
import { Logger } from '@nestjs/common';
import { OidcConfig } from '@prisma/client';
import { Issuer } from 'openid-client';

const logger = new Logger('InitOpenidClient');
const maxRetryDelaySec = 5 * 60;
const maxRetries = 10;

export const initOpenidClient = async (config: OidcConfig) => {
  let retryInterval: number | undefined = undefined;

  const _getIssuer = async (
    retry: number
  ): Promise<{ status: 'SUCCESS'; issuer: Issuer } | { status: 'FAILURE' }> => {
    try {
      const TrustIssuer = await Issuer.discover(
        `${config.issuer}/.well-known/openid-configuration`
      );
      if (retryInterval !== undefined) {
        logger.log(`Successfully contacted OIDC issuer: ${config.id}`); // let's confirm that we're good now
      }
      return {
        status: 'SUCCESS',
        issuer: TrustIssuer,
      };
    } catch (e) {
      if (retry > maxRetries) {
        logger.error(`No more retries to contact issuer: ${config.id}. ${e}`);
        return {
          status: 'FAILURE',
        };
      } else {
        // if we fail to contact the issuer, we retry with exponential backoff
        logger.error(`Failed to contact OIDC issuer: ${config.id}. ${e}`);

        const lastIntervalSeconds = retryInterval ?? 1;
        const thisIntervalSeconds = Math.min(lastIntervalSeconds * 2, maxRetryDelaySec);
        retryInterval = thisIntervalSeconds;

        logger.error(`Retrying in ${thisIntervalSeconds} seconds...`);
        await wait(thisIntervalSeconds * 1000);
        return await _getIssuer(retry + 1);
      }
    }
  };

  const issuerResult = await _getIssuer(0);
  if (issuerResult.status === 'SUCCESS') {
    return {
      status: 'SUCCESS' as const,
      client: new issuerResult.issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    };
  } else {
    return {
      status: 'FAILURE' as const,
    };
  }
};
