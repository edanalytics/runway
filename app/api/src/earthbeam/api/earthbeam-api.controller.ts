import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { makeEarthbeamJWTGuard } from './auth/earthbeam-api-auth.guard';
import { Public } from 'api/src/auth/login/public.decorator';
import {
  EarthbeamApiStatusPayloadDto,
  EarthbeamApiUnmatchedIdsPayloadDto,
  JsonValue,
  toEarthbeamApiJobResponseDto,
} from '@edanalytics/models';
import { EarthbeamApiService } from './earthbeam-api.service';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { PrismaClient } from '@prisma/client';

@Controller()
@Public()
@UseGuards(makeEarthbeamJWTGuard('access'))
@ApiTags('Earthbeam API')
export class EarthbeamApiController {
  private readonly logger = new Logger(EarthbeamApiController.name);
  constructor(
    private readonly earthbeamApiService: EarthbeamApiService,
    @Inject(PRISMA_ANONYMOUS) private prisma: PrismaClient
  ) {}

  @Get(':runId')
  async findOne(
    @Param('runId', new ParseIntPipe())
    runId: number,
    @Req() req: Request
  ) {
    this.logger.log(`handling request: ${req.url}, runId: ${runId}`);

    const result = await this.earthbeamApiService.earthbeamInputForRun(runId);
    if (result.status === 'ERROR') {
      if (result.type === 'not_found') {
        throw new NotFoundException(result.message);
      }
      throw new InternalServerErrorException(result.message);
    }

    if (result.status !== 'SUCCESS' || !result.data) {
      throw new InternalServerErrorException('Unable to construct payload');
    }

    this.logger.log(
      `sending payload: ${JSON.stringify(
        { ...result.data, assessmentDatastore: 'redacted' },
        null,
        2
      )}`
    );
    return toEarthbeamApiJobResponseDto(result.data);
  }

  @Post(':runId/status')
  async updateStatus(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() body: EarthbeamApiStatusPayloadDto
  ) {
    this.logger.log(`handling status update: ${JSON.stringify(body, null, 2)}`);

    await this.prisma.runUpdate.create({
      data: {
        runId,
        status: body.status,
        action: body.action,
        receivedAt: new Date(),
      },
    });

    if (body.action === 'done') {
      await this.earthbeamApiService.completeRun(
        runId,
        body.status === 'success' ? 'success' : 'error',
        this.prisma
      );
    }
  }

  @Post(':runId/error')
  async reportError(@Param('runId', ParseIntPipe) runId: number, @Body() body: any) {
    this.logger.log(`handling error for run ${runId}: ${JSON.stringify(body, null, 2)}`);
    await this.prisma.runError.create({
      data: {
        runId,
        code: body.code,
        payload: body.payload,
        receivedAt: new Date(),
      },
    });
  }

  @Post(':runId/summary')
  async reportSummary(@Param('runId', ParseIntPipe) runId: number, @Body() summary: JsonValue) {
    if (summary) {
      await this.prisma.run.update({
        where: { id: runId },
        data: { summary },
      });
    }
  }

  @Post(':runId/unmatched-ids')
  async reportUnmatchedIds(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() body: EarthbeamApiUnmatchedIdsPayloadDto
  ) {
    try {
      // Save the unmatched ID guidance information to the database
      await this.prisma.run.update({
        where: { id: runId },
        data: { unmatchedStudentsInfo: { name: body.name, type: body.type } },
      });
    } catch (error) {
      // TODO: Standardize database error handling across all endpoints
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `failed to save unmatched ID guidance for run ${runId}: ${errorMessage}`,
        errorStack
      );
      throw new InternalServerErrorException('Failed to save unmatched ID guidance');
    }
  }
}
