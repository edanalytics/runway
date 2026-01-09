import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { EXTERNAL_API_RESOURCE_SCOPES, ExternalApiScopeType } from './external-api-scope.decorator';

/**
 * Parameter decorator to extract the verified JWT token payload from the request.
 * Use this in controller methods protected by ExternalApiTokenGuard.
 *
 * @example
 * ```ts
 * @Post()
 * @ExternalApiScope('create:jobs')
 * async createJob(@TokenPayload() token: ExternalApiTokenPayload) {
 *   const partnerId = token.sub;
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
