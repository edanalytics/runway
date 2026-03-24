import {
  GetSchoolYearConfigDto,
  PutSchoolYearConfigDto,
} from '@edanalytics/models';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../methods';

export type { GetSchoolYearConfigDto, PutSchoolYearConfigDto };
export type { GetSchoolYearConfigRowDto } from '@edanalytics/models';

const QUERY_KEY = ['school-year-config'];

export const useSchoolYearConfig = () =>
  useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.get<GetSchoolYearConfigDto>('/school-year-config');
      return res as unknown as GetSchoolYearConfigDto;
    },
  });

export const useUpdateSchoolYearConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: PutSchoolYearConfigDto) => {
      return apiClient.put('/school-year-config', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
};
