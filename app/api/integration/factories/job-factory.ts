import { OdsConnection, RunStatus, Tenant } from '@prisma/client';
import { WithoutAudit } from '../fixtures/utils/created-modified';
import { DtoableJob, IEarthmoverBundle, JsonArray } from '@edanalytics/models';
import { makePostJobDto } from './job-input-factory';
import { makeJobTemplate } from './job-template-factory';
import { randomString } from '../fixtures/utils/random-string';
import { instanceToPlain } from 'class-transformer';

export const seedJob = async ({
  odsConnection,
  bundle,
  tenant,
  runStatus = 'new',
  summary = false,
  unmatchedStudentsInfo = false,
  outputFiles = false,
}: {
  odsConnection: WithoutAudit<OdsConnection>;
  bundle: IEarthmoverBundle;
  tenant: WithoutAudit<Tenant>;
  runStatus?: RunStatus;
  summary?: boolean;
  unmatchedStudentsInfo?: boolean;
  outputFiles?: boolean;
}): Promise<DtoableJob> => {
  const postJobDto = makePostJobDto(makeJobTemplate(bundle), odsConnection);
  return prisma.job.create({
    data: {
      ...postJobDto,
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
