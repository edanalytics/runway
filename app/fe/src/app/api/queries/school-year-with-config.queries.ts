import { GetSchoolYearWithConfigDto } from '@edanalytics/models';
import { apiClient } from '../methods';
import { plainToInstance } from 'class-transformer';

const QUERY_KEY = ['school-years', 'config'];

export const schoolYearWithConfigQueries = {
  queryKey: QUERY_KEY,
  queryFn: async () => {
    const res = (await apiClient.get('/school-years/config')) as unknown as any[];
    return plainToInstance(GetSchoolYearWithConfigDto, res ?? []);
  },
};
