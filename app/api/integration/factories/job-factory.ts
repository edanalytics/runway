import { OdsConfig, RunStatus, Tenant } from '@prisma/client';
import { WithoutAudit } from '../fixtures/utils/created-modified';
import { IEarthmoverBundle, JsonArray } from '@edanalytics/models';
import { makePostJobDto } from './job-input-factory';
import { makeJobTemplate } from './job-template-factory';
import { randomString } from '../fixtures/utils/random-string';
import { instanceToPlain } from 'class-transformer';

export const seedJob = async (
  params: {
    bundle: IEarthmoverBundle;
    tenant: WithoutAudit<Tenant>;
    runStatus?: RunStatus;
    summary?: boolean;
    unmatchedStudentsInfo?: boolean;
    outputFiles?: boolean;
  } & (
    // Each branch has exactly one way to provide schoolYearId, so callers can't
    // construct a plausible-looking but inconsistent set of args.
    | { sendToOds?: true; odsConfig: WithoutAudit<OdsConfig>; schoolYearId?: never }
    | { sendToOds: false; schoolYearId: string; odsConfig?: never }
  )
) => {
  const {
    bundle,
    tenant,
    runStatus = 'new',
    summary = false,
    unmatchedStudentsInfo = false,
    outputFiles = false,
  } = params;

  // sendToOds defaults to true (omitted in the ODS branch of the union)
  const { odsId, schoolYearId, sendToOds } =
    params.sendToOds === false
      ? { odsId: null, schoolYearId: params.schoolYearId, sendToOds: false }
      : { odsId: params.odsConfig.id, schoolYearId: params.odsConfig.schoolYearId, sendToOds: true };

  const postJobDto = makePostJobDto(makeJobTemplate(bundle), schoolYearId);

  return prisma.job.create({
    data: {
      ...postJobDto,
      odsId,
      sendToOds,
      inputParams: postJobDto.inputParams as unknown as JsonArray,
      template: instanceToPlain(postJobDto.template),
      tenantCode: tenant.code,
      partnerId: tenant.partnerId,
      fileProtocol: 's3',
      fileBucketOrHost: 'test-bucket',
      fileBasePath: 'test-base-path',
      files: {
        createMany: {
          data: postJobDto.files.map((f) => ({
            ...f,
            nameInternal: randomString('test-name-internal'),
            path: randomString('test-path'),
          })),
        },
      },
      runs: {
        create: {
          status: runStatus,
          ...(summary && {
            summary: { testSummary: randomString('test-summary') },
          }),
          ...(unmatchedStudentsInfo && {
            unmatchedStudentsInfo: {
              name: randomString('unmatched-students-name'),
              type: randomString('unmatched-students-type'),
            },
          }),
          ...(outputFiles && {
            runOutputFile: {
              create: {
                name: randomString('output-file-name'),
                path: randomString('output-file-path'),
              },
            },
          }),
        },
      },
    },
    include: {
      files: true,
      runs: {
        include: {
          runError: true,
          runOutputFile: true,
        },
      },
    },
  });
};
