import { GetSessionDataDto } from '@edanalytics/models';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrivilegeKey } from 'models/src/dtos/privileges';
import { AUTHORIZE_KEY } from '../helpers/authorize.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { rolePrivileges } from 'models/src/dtos/role-privileges';
import { Request } from 'express';
import { plainToInstance } from 'class-transformer';
import { AuthService } from '../auth.service';
@Injectable()
export class AuthorizedGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}
  async canActivate(context: ExecutionContext) {
    const privilege = this.reflector.getAllAndOverride<PrivilegeKey | null>(AUTHORIZE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (privilege === undefined) {
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request: Request = context.switchToHttp().getRequest();
    if (request.isAuthenticated()) {
      const user = request['user'];
      const userDto = plainToInstance(GetSessionDataDto, user);
      try {
        if (privilege === null) {
          Logger.verbose('Authorization explicitly skipped for route' + request.url);
          return true;
        } else {
          if (!userDto.privileges.has(privilege)) {
            return false;
          }
        }
      } catch (authorizationSystemError) {
        Logger.log(authorizationSystemError);
        return false;
      }

      return true;
    } else {
      return false;
    }
  }
}
