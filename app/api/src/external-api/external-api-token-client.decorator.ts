import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Client info extracted from the verified JWT token.
 */
export interface ApiTokenClient {
  /** The issuer (iss claim) of the token - typically the IdP URL */
  issuer: string | undefined;
  /** The client ID (client_id or azp claim) that obtained the token */
  clientId: string | undefined;
  /** Optional display name for the client (client_name claim, if configured in the IdP) */
  clientName: string | undefined;
}

/**
 * Parameter decorator to extract API client info from the verified JWT token.
 *
 * Use this in controller methods protected by ExternalApiTokenGuard.
 *
 * @example
 * ```ts
 * @Post()
 * @ExternalApiScope('create:jobs')
 * async createJob(@ExternalApiTokenClient() client: ApiTokenClient) {
 *   // client.issuer - the IdP that issued the token
 *   // client.clientId - the OAuth client ID
 *   // client.clientName - optional display name
 * }
 * ```
 */
export const ExternalApiTokenClient = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ApiTokenClient => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const payload = request.tokenPayload;

    return {
      issuer: payload?.iss,
      clientId: payload?.client_id ?? payload?.azp,
      clientName: payload?.client_name,
    };
  }
);
