import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ExternalApiTokenPayload } from '../types/express';

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
export const TokenPayload = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ExternalApiTokenPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.tokenPayload;
  }
);
