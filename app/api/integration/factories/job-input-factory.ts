import { GetJobTemplateDto, PostJobDto } from '@edanalytics/models';
import { OdsConfig } from '@prisma/client';
import { WithoutAudit } from '../fixtures/utils/created-modified';

export const makePostJobDto = (
  template: GetJobTemplateDto,
  odsConfig: WithoutAudit<OdsConfig>,
  overrides?: Partial<PostJobDto>
): PostJobDto => {
  return {
    name: template.name,
    odsId: odsConfig.id,
    schoolYearId: odsConfig.schoolYearId,
    files: template.files.map((f) => ({
      nameFromUser: `${f.templateKey}-file.csv`,
      type: f.fileType[0] ?? 'csv',
      templateKey: f.templateKey,
    })),
    inputParams: template.params.map((p) => ({
      ...p,
      // Use first allowed value if specified, otherwise use a generic test value
      value: p.allowedValues?.[0] ?? 'test input',
    })),
    template: template,
    previousJobId: null,
    ...overrides,
  };
};
