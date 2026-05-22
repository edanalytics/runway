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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { EduSnowflakePoolService } from './edu-snowflake-pool.service';
import { PRISMA_ANONYMOUS } from 'api/src/database';
import { Prisma, PrismaClient } from '@prisma/client';
import { FileService } from 'api/src/files/file.service';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

@Controller()
@Public()
@UseGuards(makeEarthbeamJWTGuard('access'))
@ApiTags('Earthbeam API')
export class EarthbeamApiController {
  private readonly logger = new Logger(EarthbeamApiController.name);
  constructor(
    private readonly earthbeamApiService: EarthbeamApiService,
    @Inject(PRISMA_ANONYMOUS) private prisma: PrismaClient,
    private readonly fileService: FileService,
    private readonly eduPool: EduSnowflakePoolService
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

  @Get(':runId/roster')
  async streamRoster(@Param('runId', ParseIntPipe) runId: number, @Res() res: Response) {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: { job: { include: { tenant: { include: { partner: true } } } } },
    });
    if (!run) {
      throw new NotFoundException(`Run not found: ${runId}`);
    }
    const { partner } = run.job.tenant;
    if (!partner.crossYearMatchingEnabled) {
      throw new ConflictException('Cross-year matching is not enabled for this partner');
    }
    // Don't pre-check creds here — the stream attempt will fail loudly if the
    // pool can't be built, and the headersSent-aware catch below converts that
    // to a clean 500. Re-checking would mean two AWS round-trips per cold
    // roster request (this check + pool creation).

    res.setHeader('Content-Type', 'application/x-ndjson');
    const { partnerId, tenantCode } = run.job;
    const startedAt = Date.now();
    let rowCount = 0;
    try {
      await this.eduPool.use(partnerId, async (connection) => {
        const sqlText = `
          WITH ids AS (
            SELECT
              seoa.tenant_code,
              seoa.api_year,
              seoa.k_student,
              seoa.k_student_xyear,
              seoa.student_unique_id,
              seoa.ed_org_id,
              seo_ids.id_system,
              OBJECT_CONSTRUCT_KEEP_NULL(
                'studentIdentificationSystemDescriptor', seo_ids.id_system,
                'identificationCode', seo_ids.id_code
              ) AS stu_id_code
            FROM stg_ef3__student_education_organization_associations seoa
            LEFT JOIN stg_ef3__stu_ed_org__identification_codes seo_ids
              ON seoa.k_student = seo_ids.k_student
            WHERE seoa.tenant_code = :1
            QUALIFY MAX(seoa.api_year) OVER (PARTITION BY seoa.k_student_xyear) = seoa.api_year
          )
          SELECT
            OBJECT_CONSTRUCT(
              'educationOrganizationId', ed_org_id,
              'link', OBJECT_CONSTRUCT('rel', 'LocalEducationAgency')
            ) AS "educationOrganizationReference",
            OBJECT_CONSTRUCT('studentUniqueId', student_unique_id) AS "studentReference",
            ARRAY_AGG(DISTINCT stu_id_code) AS "studentIdentificationCodes"
          FROM ids
          GROUP BY ALL
        `;

        // pipeline manages backpressure and destroys downstream streams on error
        await pipeline(
          connection.execute({ sqlText, binds: [tenantCode], streamResult: true }).streamRows(),
          new Transform({
            writableObjectMode: true,
            transform(row, _enc, cb) {
              rowCount += 1;
              cb(null, JSON.stringify(row) + '\n');
            },
          }),
          res
        );
      });
      this.logger.log(
        `cross-year roster: partnerId=${partnerId} tenantCode=${tenantCode} rowCount=${rowCount} durationMs=${
          Date.now() - startedAt
        }`
      );
    } catch (err) {
      this.logger.error(
        `cross-year roster fetch failed for run ${runId}: ${err instanceof Error ? err.message : String(err)}`
      );
      // Abrupt close was a deliberate choice for *mid-stream* failures. If
      // headers haven't been sent yet (pool acquire / execute failed before
      // any rows), emit a clean 500 instead — easier for the executor to
      // diagnose than a torn TCP connection.
      if (res.headersSent) {
        if (!res.destroyed) {
          res.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      } else {
        throw new InternalServerErrorException(
          err instanceof Error ? err.message : String(err)
        );
      }
    }
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
          select: { fileBasePath: true },
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`Run not found: ${runId}`);
    }

    // Canonicalize: strip trailing slashes for consistent storage and uniqueness checks
    const canonicalPath = body.path.replace(/\/+$/, '');

    if (!canonicalPath.startsWith(`${run.job.fileBasePath}/`)) {
      throw new BadRequestException(
        "Invalid output files path: must be within the job's data directory"
      );
    }

    const s3KeyPrefix = `${canonicalPath}/`;

    const outputFiles = await this.fileService.listFilesAtPath(s3KeyPrefix);
    if (outputFiles.length === 0) {
      throw new BadRequestException('No files found at the given path');
    }
    const outputFileSet = await this.prisma.runOutputFileSet
      .create({
        data: {
          runId,
          path: canonicalPath,
          files: outputFiles.map((f) => f.name),
          sentToOds: body.sentToOds,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(`Output file set already exists for this run and path`);
        }
        throw error;
      });

    return { uid: outputFileSet.uid };
  }
}
