import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import {
  EXTERNAL_API_RESOURCE_SCOPES,
  ExternalApiScopeType,
} from './auth/external-api-scope.decorator';

/**
 * Parameter decorator to extract the scopes from the verified JWT token.
 * Filters to scopes that Runway recognizes.
 *
 * Use this in controller methods protected by ExternalApiTokenGuard.
 *
 * @example
 * ```ts
 * @Post()
 * @ExternalApiScope('create:jobs')
 * async createJob(@ExternalApiScopes() scopes: ExternalApiScopeType[]) {
 *   const allowedPartnerCodes = scopes.filter((scope) => scope.startsWith('partner:')).map((scope) => scope.split(':')[1]);
 *   // ...
 * }
 * ```
 */
export const ExternalApiScopes = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ExternalApiScopeType[] | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const tokenScopes = request.tokenPayload?.scope.split(' ');
    return tokenScopes?.filter(
      (scope): scope is ExternalApiScopeType =>
        scope.startsWith('partner:') ||
        (EXTERNAL_API_RESOURCE_SCOPES as readonly string[]).includes(scope)
    );
  }
);
