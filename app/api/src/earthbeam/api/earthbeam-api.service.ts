import {
  EarthbeamApiJobResponseDto,
  GetJobTemplateDto,
  JobInputParamDto,
  toGetJobDto,
} from '@edanalytics/models';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CustomDescriptorMapping,
  PrismaClient,
  Run,
  BundleDescriptorMapping,
} from '@prisma/client';
import { PRISMA_READ_ONLY } from 'api/src/database';
import { EncryptionService } from 'api/src/encryption/encryption.service';
import { plainToInstance } from 'class-transformer';
import {
  earthbeamErrorUpdateEndpoint,
  earthbeamOutputFilesEndpoint,
  earthbeamRosterEndpoint,
  earthbeamStatusUpdateEndpoint,
  earthbeamSummaryEndpoint,
  earthbeamUnmatchedIdsEndpoint,
} from './earthbeam-api.endpoints';
import { FileService } from 'api/src/files/file.service';
import { rosterFileKey } from 'api/src/earthbeam/roster-path';
import { AppConfigService } from 'api/src/config/app-config.service';
import { groupBy, mapValues } from 'lodash';
import {
  EventEmitterService,
  EVENT_EMITTER_SERVICE,
} from 'api/src/event-emitter/event-emitter.service';
import type { Response } from 'express';
import { EduSnowflakePoolService } from './edu-snowflake-pool.service';

@Injectable()
export class EarthbeamApiService {
  private readonly logger = new Logger(EarthbeamApiService.name);
  constructor(
    @Inject(PRISMA_READ_ONLY)
    private readonly prisma: PrismaClient,
    private readonly encryptionService: EncryptionService,
    private readonly fileService: FileService,
    private readonly configService: AppConfigService,
    @Inject(EVENT_EMITTER_SERVICE) private readonly eventEmitter: EventEmitterService,
    private readonly eduPool: EduSnowflakePoolService
  ) {}

  async getCrossYearRosterContext(runId: Run['id']) {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: { job: { include: { tenant: { include: { partner: true } } } } },
    });
    if (!run) {
      return { status: 'ERROR' as const, type: 'not_found' as const, message: `Run not found: ${runId}` };
    }
    const partner = run.job.tenant.partner;
    if (!partner.crossYearMatchingEnabled) {
      return {
        status: 'ERROR' as const,
        type: 'conflict' as const,
        message: 'Cross-year matching is not enabled for this partner',
      };
    }
    if (!(await this.configService.eduCredsExist(partner.id))) {
      return {
        status: 'ERROR' as const,
        type: 'conflict' as const,
        message: 'EDU connection info is not available for this partner',
      };
    }
    return {
      status: 'SUCCESS' as const,
      data: { partnerId: partner.id, tenantCode: run.job.tenant.code },
    };
  }

  /**
   * Streams a cross-year roster from EDU/Snowflake to the response as NDJSON.
   * Uses a partner-scoped connection pool; on stream error the response is
   * destroyed (no in-band sentinel) — the Executor detects truncation and
   * fails the run.
   */
  async streamCrossYearRoster({
    partnerId,
    tenantCode,
    response,
  }: {
    partnerId: string;
    tenantCode: string;
    response: Response;
  }): Promise<void> {
    const startedAt = Date.now();
    let rowCount = 0;
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

      await new Promise<void>((resolve, reject) => {
        const stmt = connection.execute({
          sqlText,
          binds: [tenantCode],
          streamResult: true,
        });
        const rowStream = stmt.streamRows();
        rowStream.on('data', (row) => {
          response.write(JSON.stringify(row) + '\n');
          rowCount += 1;
        });
        rowStream.on('end', () => {
          response.end();
          resolve();
        });
        rowStream.on('error', (err) => {
          response.destroy(err);
          reject(err);
        });
      });
    });
    this.logger.log(
      `cross-year roster: partnerId=${partnerId} tenantCode=${tenantCode} rowCount=${rowCount} durationMs=${Date.now() - startedAt}`
    );
  }

  async earthbeamInputForRun(runId: Run['id']) {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: {
        job: {
          include: {
            files: true,
            odsConfig: {
              include: {
                activeConnection: true,
              },
            },
            schoolYear: true,
            tenant: {
              include: {
                partner: true,
              },
            },
          },
        },
      },
    });

    if (!run) {
      return {
        status: 'ERROR',
        type: 'not_found',
        message: `Run not found: ${runId}`,
      };
    }

    const job = run.job;
    const odsConnection = job.odsConfig?.activeConnection;
    if (job.sendToOds && !odsConnection) {
      return {
        status: 'ERROR',
        type: 'server_error',
        message: 'No ODS configured',
      };
    }

    if (!job.template) {
      return {
        status: 'ERROR',
        type: 'server_error',
        message: 'No job template found',
      };
    }

    // use env vars from the earthmover bundle to make sure we don't allow users to inject random env vars
    const template = plainToInstance(GetJobTemplateDto, job.template);
    const envVars = template.params.map((param) => param.templateKey);

    const paramsFromUser = Array.isArray(job.inputParams)
      ? job.inputParams.map((p) => plainToInstance(JobInputParamDto, p)) // TODO not a huge fan of using DTOs here and above
      : []; // no input params, which could be fine if that's what the bundle wants?

    const paramsForEarthbeam = envVars.reduce<Record<string, string>>((acc, envVar) => {
      const val = paramsFromUser.find((param) => param.templateKey === envVar)?.value;
      if (val !== undefined && val !== null) {
        acc[envVar] = val;
      }
      return acc;
    }, {});

    const apiYear = job.schoolYear.endYear.toString();
    paramsForEarthbeam['API_YEAR'] = apiYear; // executor assumes this is a string
    const descriptorNamespace = job.tenant.partner.descriptorNamespace;
    if (descriptorNamespace) {
      paramsForEarthbeam['DESCRIPTOR_NAMESPACE'] = descriptorNamespace;
    }
    const filesForEarthbeam = job.files.reduce<Record<string, string>>((acc, file) => {
      acc[file.templateKey] = file.nameInternal;
      return acc;
    }, {});

    // A note on handling custom descriptor mappings:
    // Currently, we format custom descriptor mappings but do not do additional validation,
    // such as verifying that mappings are complete (each EdFi default has a corresponding
    // override) or checking that the custom descriptors exist in the target ODS. We assume
    // that the process to load bundle and custom mappings produced a complete (for this
    // assessment) and valid set of mappings. Over time, we'll add features such as automated
    // syncing of bundle descriptor mappings from the bundles repo and runtime checks for
    // completeness and validity of custom mappings on an as-needed basis. This will become
    // more important as we allow custom mappings to be edited in the UI and we hand more
    // control over to end users.
    const customDescriptorMappings = await this.prisma.customDescriptorMapping.findMany({
      where: {
        partnerId: job.partnerId,
        bundleKey: template.path,
      },
      include: {
        bundleDescriptorMapping: true,
      },
    });

    const executorBaseUrl = this.configService.executorCallbackBaseUrl();

    const partnerId = job.tenant.partnerId;
    const crossYearMatchAvailable =
      job.tenant.partner.crossYearMatchingEnabled &&
      (await this.configService.eduCredsExist(partnerId));

    const payload: EarthbeamApiJobResponseDto = {
      appDataBasePath: `${job.fileProtocol}://${job.fileBucketOrHost}/${job.fileBasePath}`,
      inputFiles: filesForEarthbeam,
      inputParams: paramsForEarthbeam,
      customDescriptorMappings:
        customDescriptorMappings.length > 0
          ? formatCustomDescriptorMappings(customDescriptorMappings)
          : null,
      bundle: {
        path: template.path,
        branch: this.configService.bundleBranch(),
      },
      appUrls: {
        status: `${executorBaseUrl}/${earthbeamStatusUpdateEndpoint(runId)}`,
        error: `${executorBaseUrl}/${earthbeamErrorUpdateEndpoint(runId)}`,
        summary: `${executorBaseUrl}/${earthbeamSummaryEndpoint(runId)}`,
        unmatchedIds: `${executorBaseUrl}/${earthbeamUnmatchedIdsEndpoint(runId)}`,
        outputFiles: `${executorBaseUrl}/${earthbeamOutputFilesEndpoint(runId)}`,
        ...(crossYearMatchAvailable
          ? { roster: `${executorBaseUrl}/${earthbeamRosterEndpoint(runId)}` }
          : {}),
      },
      crossYearMatchAvailable,
      sendToOds: job.sendToOds,
      rosterFilePath: job.sendToOds
        ? undefined
        : `s3://${this.configService.rosterBucket()}/${rosterFileKey(job, job.schoolYear)}`,
      // odsConnection check narrows the type — the early guard ensures it's present when sendToOds
      assessmentDatastore: odsConnection && job.sendToOds
        ? {
            apiYear: job.schoolYear.endYear.toString(),
            url: odsConnection.host,
            clientId: odsConnection.clientId,
            clientSecret: await this.encryptionService.decrypt(odsConnection.clientSecret),
          }
        : undefined,
    };
    return {
      status: 'SUCCESS',
      data: payload,
    };
  }

  async completeRun(runId: Run['id'], status: 'success' | 'error', prisma: PrismaClient) {
    // TODO: probably belongs in earthbeam-run.service.ts ?
    const run = await prisma.run.update({
      where: { id: runId },
      data: { status },
      include: {
        job: { include: { files: true, odsConfig: { include: { activeConnection: true } } } },
        runError: true,
        userRunCreatedByIdTouser: true,
      },
    });

    // Save output files
    const basePath = `${run.job.fileBasePath}/output/`;
    const outputFiles = await this.fileService.listFilesAtPath(basePath);
    if (outputFiles.length > 0) {
      await prisma.runOutputFile.createMany({
        data: outputFiles.map((file) => ({
          runId: run.id,
          name: file.name,
          path: file.key,
        })),
      });
    }

    try {
      /**
       * We're pulling data from the run to construct this payload rather than just passing
       * the run to eventEmitter.emit for two reasons:
       *
       * 1. We don't want sensitive data accidentally ending up in Slack. Currently, there
       *    is no sensitive data to worry about, but it's conceivable that could change.
       *    So here, we're just making sure that whatever data ends up in Slack is data we
       *    decided would be OK there.
       * 2. We can simplify some data for EventBridge rules, like calling out if a run would have
       *    a "completed with errors" status. This is a hodge-podge currently. It uses the DTO
       *    because the DTO has some getters and helpful formatting. But it uses run.job for
       *    other things because the DTO doesn't include all info we want to send to Slack.
       *    And for other things (e.g. run output files), we reference a local variable since
       *    we have it handy and don't really need to do a round trip. Perhaps it'll make sense
       *    to rationalize all this, but I don't want to alter the surrounding code too much to
       *    make that happen given what we're doing with these events longterm is still a bit uncertain.
       *
       * It's messy right now and I think that's OK. If/as we emit events elsewhere, I'd like to
       * to clean this up. Ideally, emitting an event takes just one line and doesn't draw attention
       * from the primary work a given swath of code is doing (e.g. completing a run). This is way too
       * obtrusive to do elsewhere, but I want to wait until we have another instance before attempting
       * to abstract
       */
      const jobDto = toGetJobDto({ ...run.job, runs: [run] });

      const unmatchedStudentsInfo = run.unmatchedStudentsInfo;
      const { hasResourceErrors, resourceErrors } = jobDto;
      const resourceErrorString = hasResourceErrors
        ? resourceErrors.map((e) => `${e.resource} (${e.failed}/${e.total})`).join(',')
        : '';

      const hasUnmatchedStudents = outputFiles.some(
        (file) => file.name === 'input_no_student_id_match.csv'
      );
      const odsUrl = run.job.odsConfig?.activeConnection?.host;
      const assessmentType = run.job.name;
      const assessmentFiles = run.job.files.map((file) => file.nameFromUser);
      const tenantCode = run.job.tenantCode;
      const partnerId = run.job.partnerId;
      const unmatchedStudentCount = unmatchedStudentsInfo?.count ?? 0;
      const unmatchedStudentsMessage =
        unmatchedStudentCount === 0 ? '' : `${unmatchedStudentCount} unmatched`;
      const errorCode = run.status !== 'success' ? run.runError?.[0].code : null;
      const errorString = errorCode ? `ERROR: ${errorCode}` : '';

      const summaryString = `${assessmentType} (${assessmentFiles.join(
        ', '
      )}) ${errorString} ${resourceErrorString} ${unmatchedStudentsMessage} (${partnerId}/${tenantCode}) jobId ${
        run.job.id
      }`;

      await this.eventEmitter.emit('run_complete', {
        summary: summaryString,
        runId: run.id,
        jobId: run.job.id,
        status: run.status,
        completedWithErrors:
          run.status === 'success' && (hasResourceErrors || hasUnmatchedStudents),
        sendToOds: run.job.sendToOds,
        odsUrl,
        schoolYear: run.job.schoolYearId,
        unmatchedStudentsCount: unmatchedStudentsInfo?.count ?? 0,
        input: {
          assessment: assessmentType,
          files: assessmentFiles,
          params: jobDto.inputParams?.map(({ name, value }) => ({ name, value })),
        },
        result: {
          hasUnmatchedStudents,
          hasResourceErrors,
          resourceSummary: run.summary,
          errors: run.runError.map(({ code, payload }) => ({
            code,
            payload,
          })),
        },
        metadata: {
          tenantCode,
          partnerId,
          ...(run.userRunCreatedByIdTouser
            ? {
                userEmail: run.userRunCreatedByIdTouser?.email,
                userName:
                  run.userRunCreatedByIdTouser?.givenName +
                  ' ' +
                  run.userRunCreatedByIdTouser?.familyName,
              }
            : run.job.apiClientId
            ? {
                apiClientName: run.job.apiClientName ?? 'API Initiated',
              }
            : null),
          createdOn: run.createdOn.toISOString(),
          completedOn: run.modifiedOn.toISOString(),
        },
      });
    } catch (error) {
      this.logger.error(`Error emitting event: ${error} for run ${run.id}`);
    }
  }
}

function formatCustomDescriptorMappings(
  customDescriptorMappings: Array<
    CustomDescriptorMapping & { bundleDescriptorMapping: BundleDescriptorMapping }
  >
) {
  const grouped = groupBy(customDescriptorMappings, 'descriptorType');
  return mapValues(grouped, (mappings) =>
    mappings.map((mapping) => ({
      v_other_columns: mapping.leftHandSideColumns,
      edfi_descriptor: mapping.bundleDescriptorMapping.edfiDefaultDescriptor,
      local_descriptor: mapping.customDescriptor,
    }))
  );
}
