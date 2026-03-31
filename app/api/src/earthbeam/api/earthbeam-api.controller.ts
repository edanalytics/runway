import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
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
  EarthbeamApiOutputFilesPayloadDto,
  EarthbeamApiStatusPayloadDto,
  EarthbeamApiUnmatchedIdsPayloadDto,
  JsonValue,
  toEarthbeamApiJobResponseDto,
} from '@edanalytics/models';
import { EarthbeamApiService } from './earthbeam-api.service';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { PrismaClient } from '@prisma/client';
import { FileService } from 'api/src/files/file.service';

@Controller()
@Public()
@UseGuards(makeEarthbeamJWTGuard('access'))
@ApiTags('Earthbeam API')
export class EarthbeamApiController {
  private readonly logger = new Logger(EarthbeamApiController.name);
  constructor(
    private readonly earthbeamApiService: EarthbeamApiService,
    @Inject(PRISMA_ANONYMOUS) private prisma: PrismaClient,
    private readonly fileService: FileService
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
        data: { unmatchedStudentsInfo: { name: body.name, type: body.type, count: body.count } },
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

  @Post(':runId/output-files')
  @HttpCode(201)
  async reportOutputFiles(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() body: EarthbeamApiOutputFilesPayloadDto
  ) {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: {
        job: {
          select: { fileProtocol: true, fileBucketOrHost: true, fileBasePath: true },
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`Run not found: ${runId}`);
    }

    const { fileProtocol, fileBucketOrHost, fileBasePath } = run.job;
    const outputFilesBasePath = `${fileProtocol}://${fileBucketOrHost}/${fileBasePath}/output`;

    if (body.path !== outputFilesBasePath && !body.path.startsWith(`${outputFilesBasePath}/`)) {
      throw new BadRequestException(
        'Invalid output files path: must be within the run\'s output directory'
      );
    }

    // Extract S3 key prefix from the full path (strip protocol://bucket/)
    const protocolBucketPrefix = `${fileProtocol}://${fileBucketOrHost}/`;
    const s3KeyPrefix = body.path.slice(protocolBucketPrefix.length);
    const normalizedPrefix = s3KeyPrefix.endsWith('/') ? s3KeyPrefix : `${s3KeyPrefix}/`;

    const s3Keys = await this.fileService.listFilesAtPath(normalizedPrefix);
    const files = (s3Keys ?? [])
      .map((key) => key?.split(normalizedPrefix)[1])
      .filter((name): name is string => typeof name === 'string' && name.length > 0);

    const existing = await this.prisma.runOutputFileSet.findFirst({
      where: { runId, path: body.path },
    });
    if (existing) {
      throw new ConflictException(
        `Output file set already exists for this run and path`
      );
    }

    try {
      const outputFileSet = await this.prisma.runOutputFileSet.create({
        data: {
          runId,
          path: body.path,
          files,
          sentToOds: body.sentToOds,
        },
      });
      return { uid: outputFileSet.uid };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `failed to save output file set for run ${runId}: ${errorMessage}`,
        errorStack
      );
      throw new InternalServerErrorException('Failed to save output file set');
    }
  }
}
