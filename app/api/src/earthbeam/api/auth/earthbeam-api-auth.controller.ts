import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
    const result = await this.apiAuthService.initRun(runId);
    if (result.status === 'ERROR') {
      this.logger.error(`Failed to initialize run: ${runId}`, result.reason);
      if (result.reason === 'not found') {
        throw new NotFoundException('Run not found');
      } else if (result.reason === 'invalid token') {
        throw new UnauthorizedException('Invalid token');
      } else {
        throw new BadRequestException('Failed to initialize run');
      }
    }

    if (result.status !== 'SUCCESS') {
      this.logger.error(`Failed to initialize run. Unexpected status for run: ${runId}`, result);
      throw new InternalServerErrorException();
    }

    return toEarthbeamApiInitResponseDto(await this.apiAuthService.initResponse({ runId }));
  }
}
