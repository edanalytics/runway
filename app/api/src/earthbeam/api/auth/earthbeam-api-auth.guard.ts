import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { EarthbeamApiAuthService } from './earthbeam-api-auth.service';
import { IEarthbeamTokenPayload } from './eathbeam-api-token.interface';

export function makeEarthbeamJWTGuard(type: IEarthbeamTokenPayload['type']) {
  @Injectable()
  class EarthbeamJWTGuard implements CanActivate {
    private readonly logger = new Logger(`${EarthbeamJWTGuard.name}:${type}`);
    constructor(private readonly apiAuth: EarthbeamApiAuthService) {}

    /**
     * Verifies that request:
     * - has a token
     * - the token is valid (not expired, not tampered with)
     * - the run id in the token payload matches the run id in the request params
     * Note that this guard is only used on the access token, not the init token.
     * The auth controller handles checking the init token itself since there's a
     * bit more work to do than simply pass/fail the auth.
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      if (!('runId' in request.params)) {
        throw new Error('SETUP ERROR: JWT auth guard requires a :runId route param');
      }

      const token = this.apiAuth.extractToken(request.headers['authorization']);
      if (!token) {
        throw new UnauthorizedException('No token');
      }

      let decodedToken: IEarthbeamTokenPayload | undefined;
      try {
        decodedToken = await this.apiAuth.verifyToken(token, type);
      } catch (e) {
        this.logger.error('API auth failed', e);
        throw new UnauthorizedException('Invalid token');
      }

      const requestedId = parseInt(request.params.runId, 10);
      if (!requestedId || decodedToken.runId !== requestedId) {
        this.logger.error(`Run ID mismatch: requested ${requestedId}, token ${decodedToken.runId}`);
        throw new ForbiddenException('Invalid token');
      }

      return true;
    }
  }
  return EarthbeamJWTGuard;
}
