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
  earthbeamStatusUpdateEndpoint,
  earthbeamSummaryEndpoint,
  earthbeamUnmatchedIdsEndpoint,
} from './earthbeam-api.endpoints';
import { FileService } from 'api/src/files/file.service';
import { AppConfigService } from 'api/src/config/app-config.service';
import { groupBy, mapValues } from 'lodash';
import { EventEmitterService } from 'api/src/event-emitter/event-emitter.service';
import * as path from 'path';

@Injectable()
export class EarthbeamApiService {
  private readonly logger = new Logger(EarthbeamApiService.name);
  constructor(
    @Inject(PRISMA_READ_ONLY)
    private readonly prisma: PrismaClient,
    private readonly encryptionService: EncryptionService,
    private readonly fileService: FileService,
    private readonly configService: AppConfigService,
    private readonly eventEmitter: EventEmitterService
  ) {}

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
    if (!job.odsConfig.activeConnection) {
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

    const isLocalFileStorage = job.fileProtocol === 'file';
    const localStorageRoot = isLocalFileStorage ? job.fileBucketOrHost : null;
    if (isLocalFileStorage && (!localStorageRoot || !job.fileBasePath)) {
      return {
        status: 'ERROR',
        type: 'server_error',
        message: 'Local storage paths are not configured',
      };
    }
    if (!isLocalFileStorage && (!job.fileBucketOrHost || !job.fileBasePath)) {
      return {
        status: 'ERROR',
        type: 'server_error',
        message: 'File storage paths are not configured',
      };
    }

    const filesForEarthbeam = job.files.reduce<Record<string, string>>((acc, file) => {
      if (isLocalFileStorage) {
        const localPath = path.join(localStorageRoot ?? '', file.path);
        acc[file.templateKey] = `file://${localPath}`;
      } else {
        acc[file.templateKey] = file.nameInternal;
      }
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

    const appDataBasePath = isLocalFileStorage
      ? `file://${path.join(localStorageRoot as string, job.fileBasePath as string)}`
      : `${job.fileProtocol}://${job.fileBucketOrHost}/${job.fileBasePath}`;

    const executorBaseUrl =
      this.configService.executorCallbackBaseUrl() ?? this.configService.get('MY_URL');

    const payload: EarthbeamApiJobResponseDto = {
      appDataBasePath,
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
      },
      assessmentDatastore: {
        apiYear: apiYear,
        url: job.odsConfig.activeConnection.host,
        clientId: job.odsConfig.activeConnection.clientId,
        clientSecret: await this.encryptionService.decrypt(
          job.odsConfig.activeConnection.clientSecret
        ),
      },
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
        job: { include: { files: true } },
        runError: true,
        userRunCreatedByIdTouser: true,
      },
    });

    // Save output files
    const basePath = `${run.job.fileBasePath}/output/`;
    const filePaths = await this.fileService.listFilesAtPath(basePath);
    const runOutputFiles = filePaths
      ?.map((fullPath) => ({ name: fullPath?.split(basePath)[1], path: fullPath }))
      .filter(
        (file): file is { name: string; path: string } =>
          typeof file.name == 'string' && typeof file.path == 'string'
      )
      .map((file) => ({
        runId: run.id,
        name: file.name,
        path: file.path, // contains the full path including file name
      }));

    if (runOutputFiles && runOutputFiles.length > 0) {
      await prisma.runOutputFile.createMany({
        data: runOutputFiles,
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
      const { hasResourceErrors } = jobDto;
      const hasUnmatchedStudents = runOutputFiles?.some(
        (file) => file.name === 'input_no_student_id_match.csv'
      );
      await this.eventEmitter.emit('run_complete', {
        runId: run.id,
        jobId: run.job.id,
        status: run.status,
        completedWithErrors:
          run.status === 'success' && (hasResourceErrors || hasUnmatchedStudents),
        input: {
          assessment: run.job.name,
          files: run.job.files.map((file) => file.nameFromUser),
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
          tenantCode: run.job.tenantCode,
          partnerId: run.job.partnerId,
          userEmail: run.userRunCreatedByIdTouser?.email,
          userName:
            run.userRunCreatedByIdTouser?.givenName +
            ' ' +
            run.userRunCreatedByIdTouser?.familyName,
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
