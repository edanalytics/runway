import { Injectable, Logger } from '@nestjs/common';
import * as jose from 'jose';
import { AppConfigService } from '../config/app-config.service';
import { Issuer } from 'openid-client';
import { JWTPayload } from 'jose';

@Injectable()
export class ExternalApiAuthService {
  private readonly logger = new Logger(ExternalApiAuthService.name);

  private keySet: jose.JWTVerifyGetKey | undefined;
  private readonly audience: string | undefined;
  private readonly issuerUrl: string | undefined;

  constructor(private readonly appConfig: AppConfigService) {
    const { audience, issuerUrl } = this.appConfig.getExternalApiConfig();
    this.audience = audience;
    this.issuerUrl = issuerUrl;
  }

  async onModuleInit() {
    this.keySet = await this.getKeySet();
  }

  async getKeySet(): Promise<jose.GeneralVerifyGetKey | undefined> {
    if (!this.issuerUrl) {
      this.logger.warn('No issuer URL configured, skipping key set initialization');
      return;
    }

    const issuer = await Issuer.discover(this.issuerUrl);
    if (!issuer.metadata.jwks_uri) {
      this.logger.warn(`Issuer ${this.issuerUrl} does not have a jwks_uri`); // allow app to start even if external API not available
      return;
    }

    return jose.createRemoteJWKSet(new URL(issuer.metadata.jwks_uri));
  }

  extractToken(authHeader: string | undefined) {
    const prefix = 'Bearer ';
    return authHeader && authHeader.startsWith(prefix) ? authHeader.split(prefix)[1] : null;
  }

  async verifyToken(token: string): Promise<
    | {
        result: 'success';
        payload: JWTPayload;
      }
    | {
        result: 'failed';
        error: jose.errors.JOSEError;
      }
    | { result: 'disabled' }
  > {
    if (!this.audience || !this.keySet) {
      return { result: 'disabled' };
    }
    try {
      const decoded = await jose.jwtVerify(token, this.keySet, { audience: this.audience });
      return { result: 'success', payload: decoded.payload };
    } catch (error: unknown) {
      this.logger.error('Error verifying token', JSON.stringify(error));
      return { result: 'failed', error: error as jose.errors.JOSEError };
    }
  }
}
