import { GetJobTemplateDto, PostJobDto } from '@edanalytics/models';
import { OdsConnection } from '@prisma/client';
import { WithoutAudit } from '../fixtures/utils/created-modified';

export const makePostJobDto = (
  template: GetJobTemplateDto,
  ods: WithoutAudit<OdsConnection>,
  overrides?: Partial<PostJobDto>
): PostJobDto => {
  return {
    name: template.name,
    odsId: ods.odsConfigId,
    schoolYearId: ods.schoolYearId,
    files: [
      {
        nameFromUser: 'input-file-name',
        type: 'csv',
        templateKey: 'input-file-key',
      },
    ],
    inputParams: template.params.map((p) => ({ ...p, value: 'test input' })),
    template: template,
    previousJobId: null,
    ...overrides,
  };
};
