import {
  GetSchoolYearConfigDto,
  PutSchoolYearConfigRowDto,
} from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, apiClientRaw } from '../methods';
import { schoolYearWithConfigQueries } from './school-year-with-config.queries';

const QUERY_KEY = ['school-year-config'];

export const schoolYearConfigQueries = {
  queryKey: QUERY_KEY,
  queryFn: async () => {
    const res = await apiClientRaw.get<GetSchoolYearConfigDto[]>('/school-year-config');
    const headerValue = res.headers['etag'];
    return {
      rows: plainToInstance(GetSchoolYearConfigDto, res.data ?? []),
      etag: Array.isArray(headerValue) ? headerValue[0] : (headerValue ?? null),
    } satisfies { rows: GetSchoolYearConfigDto[]; etag: string | null };
  },
};

export const useUpdateSchoolYearConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rows,
      etag,
    }: {
      rows: PutSchoolYearConfigRowDto[];
      etag: string | null;
    }) => {
      return apiClient.put('/school-year-config', rows, {
        headers: etag ? { 'if-match': etag } : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: schoolYearWithConfigQueries.queryKey });
    },
  });
};
