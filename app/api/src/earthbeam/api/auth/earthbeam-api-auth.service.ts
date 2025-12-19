import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from 'api/src/config/app-config.service';
import { IEarthbeamTokenPayload } from './eathbeam-api-token.interface';
import { earthbeamInitEndpoint, earthbeamJobInfoEndpoint } from '../earthbeam-api.endpoints';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { PrismaClient, Run } from '@prisma/client';

@Injectable()
export class EarthbeamApiAuthService {
  private readonly initTokenExpirationSec = 5 * 60;
  private readonly accessTokenExpirationSec = 24 * 60 * 60;

  constructor(
    @Inject(PRISMA_ANONYMOUS)
    private readonly prisma: PrismaClient, // API writes are not tied to a user
    private readonly jwtService: JwtService,
    private readonly appConfigService: AppConfigService
  ) {}

  private createToken(payload: IEarthbeamTokenPayload, expiresIn: number) {
    return this.jwtService.sign(payload, { expiresIn });
  }

  // short lived token to initialize the executor job
  async createInitToken(payload: Omit<IEarthbeamTokenPayload, 'type'>) {
    return this.createToken({ ...payload, type: 'init' }, this.initTokenExpirationSec);
  }

  initEndpoint({ runId }: { runId: number }) {
    return `${this.appConfigService.get('MY_URL')}/${earthbeamInitEndpoint(runId)}`;
  }

  // longer-lived token to auth remaining api requests
  async createAccessToken(payload: Omit<IEarthbeamTokenPayload, 'type'>) {
    return this.createToken({ ...payload, type: 'access' }, this.accessTokenExpirationSec);
  }

  extractToken(authHeader: string | undefined) {
    const prefix = 'Bearer ';
    return authHeader && authHeader.startsWith(prefix) ? authHeader.split(prefix)[1] : null;
  }

  async verifyToken(
    token: string,
    expectedType: IEarthbeamTokenPayload['type']
  ): Promise<IEarthbeamTokenPayload> {
    const decoded = await this.jwtService.verify(token); // throws if token expired or signature invalid

    if (
      // sanity check; if token is valid and we constructed it properly
      // to begin with, these checks should never pass
      decoded === null ||
      typeof decoded !== 'object' ||
      !('runId' in decoded) ||
      !('type' in decoded) ||
      decoded.type !== expectedType
    ) {
      throw new Error('Invalid token');
    }

    return { runId: decoded.runId, type: decoded.type };
  }

  async initRun(
    runId: number
  ): Promise<
    { status: 'SUCCESS'; run: Run } | { status: 'ERROR'; reason: 'not found' | 'invalid token' }
  > {
    // TODO: probably should move to job/run service so we can track the run states all in one place
    return await this.prisma.$transaction(async (tx) => {
      let run = await tx.run.findUnique({ where: { id: runId } });
      if (!run) {
        return { status: 'ERROR', reason: 'not found' };
      }

      if (run.status !== 'new') {
        // cannot use a token twice, so if run is not new, the token has already been used
        return { status: 'ERROR', reason: 'invalid token' };
      }

      run = await tx.run.update({
        where: { id: runId },
        data: { status: 'running' },
      });

      return { status: 'SUCCESS', run };
    });
  }

  async initResponse({ runId }: { runId: Run['id'] }) {
    return {
      token: await this.createAccessToken({ runId }),
      jobUrl: `${this.appConfigService.get('MY_URL')}/${earthbeamJobInfoEndpoint(runId)}`,
    };
  }
}
