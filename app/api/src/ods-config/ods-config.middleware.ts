import { BadRequestException, NotFoundException, Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { OdsConfigService } from './ods-config.service';

/**
 * This middleware adds the OdsConfig to the request object. It
 * throws if there is no OdsConfig ID in the request parameters
 * or if there is but it is unable to locate the OdsConfig. It
 * should only be used on routes that have an OdsConfig ID and
 * where the OdsConfig is required.
 */

@Injectable()
export class AddOdsConfigMiddleware implements NestMiddleware {
  constructor(private odsConfigService: OdsConfigService) { }
  async use(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated()) {
      throw new UnauthorizedException()
    }
    const id = parseInt(req.params.odsConfigId, 10);
    if (!id) {
      throw new BadRequestException('Invalid parameter for :odsConfigId');
    }

    const odsConfig = await this.odsConfigService.findOne(id);
    if (!odsConfig) {
      throw new NotFoundException(`No ODS config found for ID: ${id}`);
    }

    // Later, the auth guard checks the tenant to ensure the user has access.
    // For now, we just decorate the request object with the OdsConfig.
    req.odsConfig = odsConfig;
    next();
  }
}
