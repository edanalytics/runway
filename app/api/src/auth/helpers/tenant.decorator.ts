import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const Tenant = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();

  // Although the prop is request.user, this is what we treat as the session object.
  // In the DB, it's what exists under { passport: user: { ... session data ... } }
  if (!request.user) {
    throw new Error('No session for user');
  }

  return request.user.tenant;
});
