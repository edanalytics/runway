import {
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  ParseIntPipe,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PRISMA_ANONYMOUS } from '../../../database';
import { PrismaClient } from '@prisma/client';
import { makeEarthbeamJWTGuard } from './earthbeam-api-auth.guard';
import { EarthbeamApiAuthService } from './earthbeam-api-auth.service';
import { Public } from 'api/src/auth/login/public.decorator';
import { toEarthbeamApiInitResponseDto } from '@edanalytics/models';
import { advanceRunStatus } from '../../../jobs/run-status';

@Controller()
@Public() // do not require session auth
@UseGuards(makeEarthbeamJWTGuard('init')) // check init JWT
@ApiTags('Earthbeam API Auth')
export class EarthbeamApiAuthController {
  private readonly logger = new Logger(EarthbeamApiAuthController.name);
  constructor(
    @Inject(PRISMA_ANONYMOUS) private prisma: PrismaClient, // API writes are not tied to a user
    private readonly apiAuthService: EarthbeamApiAuthService
  ) {}

  @Get(':runId/init')
  async init(@Param('runId', ParseIntPipe) runId: number) {
    // Only from `new`, so a run's status is never overwritten.
    const run = await advanceRunStatus(this.prisma, runId, 'new', 'running');
    if (!run) {
      // The token has been used, or the run failed to launch (or, which shouldn't
      // happen, no longer exists).
      this.logger.error(`Failed to initialize run: ${runId}`);
      throw new UnauthorizedException('Invalid token');
    }

    return toEarthbeamApiInitResponseDto(await this.apiAuthService.initResponse({ runId }));
  }
}
