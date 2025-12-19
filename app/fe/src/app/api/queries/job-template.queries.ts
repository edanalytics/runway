import { GetJobTemplateDto, JobTemplateType } from '@edanalytics/models';
import { useQuery } from '@tanstack/react-query';
import { methods } from '../methods';

export const jobTemplateQueries = {
  get(type: JobTemplateType) {
    return {
      queryKey: ['jobTemplate', type],
      queryFn: async () =>
        methods.getMany<GetJobTemplateDto>(`job-templates/${type}`, GetJobTemplateDto),
    };
  },
};
