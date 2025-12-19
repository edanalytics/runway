import { IEarthmoverBundle, toGetJobTemplateDto } from '@edanalytics/models';

export const makeJobTemplate = (bundle: IEarthmoverBundle) => {
  return toGetJobTemplateDto(bundle);
};
