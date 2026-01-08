/**
 * Protects external API endpoints. Requires:
 * - a valid JWT access token
 * - signed by the correct issuer
 * - for the `EXTERNAL_API_TOKEN_AUDIENCE` audience
 * - with scope required by the requested endpoint (e.g. create:jobs)
 * - with a partner scope that matches the partner that owns the resource being operated upon
 *   (note that this partner scope is not the typical use of a scope, but fine for now)
 *
 * If all of the above holds, the token will be parsed and saved to the
 * request object. It can be accessed via the @TokenPayload() decorator.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ExternalApiAuthService } from './external-api.auth.service';
import { Reflector } from '@nestjs/core';
import { JWTPayload } from 'jose';
import { EXTERNAL_API_SCOPE_KEY } from './external-api-scope.decorator';
import { Request } from 'express';

/** Token payload for external API requests. Extends JWTPayload with required scope. */
export type ExternalApiTokenPayload = JWTPayload & { scope: string };
@Injectable()
export class ExternalApiTokenGuard implements CanActivate {
  private readonly logger = new Logger(ExternalApiTokenGuard.name);
  constructor(private readonly apiAuth: ExternalApiAuthService, private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.apiAuth.extractToken(request.headers['authorization']);
    if (!token) {
      throw new UnauthorizedException('No token');
    }

    let tokenPayload: JWTPayload;
    const verifyResult = await this.apiAuth.verifyToken(token);
    if (verifyResult.result === 'success') {
      tokenPayload = verifyResult.payload;
    } else if (verifyResult.result === 'failed') {
      this.logger.log('Failed External API token verification', verifyResult.error);
      throw new UnauthorizedException('Invalid token');
    } else if (verifyResult.result === 'disabled') {
      this.logger.log('External API token verification is disabled.');
      throw new ServiceUnavailableException('External API token verification is disabled.');
    } else {
      this.logger.error('Unknown error verifying token', JSON.stringify(verifyResult));
      throw new InternalServerErrorException('Unknown error verifying token');
    }

    const requiredScopes = this.reflector.getAllAndMerge<string[]>(EXTERNAL_API_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredScopes || requiredScopes.length === 0) {
      // cause tests to fail on a config error
      throw new InternalServerErrorException('Config error: Endpoint has no required scopes');
    }

    if (typeof tokenPayload.scope !== 'string') {
      throw new ForbiddenException('Token missing scope claim');
    }
    const tokenScopes = tokenPayload.scope.split(' ');
    if (!requiredScopes.every((scope) => tokenScopes.includes(scope))) {
      throw new ForbiddenException('Insufficient scopes');
    }

    // decorate request with token payload so controller can access it
    // Type assertion is safe: we've validated scope is a string above
    request.tokenPayload = tokenPayload as ExternalApiTokenPayload;
    return true;
  }
}
