import { GetJobTemplateDto, PostJobDto } from '@edanalytics/models';

export const makePostJobDto = (
  template: GetJobTemplateDto,
  schoolYearId: string,
  overrides?: Partial<PostJobDto>
): PostJobDto => {
  return {
    name: template.name,
    schoolYearId,
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
