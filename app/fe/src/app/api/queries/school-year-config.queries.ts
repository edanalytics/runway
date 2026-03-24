import {
  GetSchoolYearConfigDto,
  PutSchoolYearConfigRowDto,
} from '@edanalytics/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, apiClientRaw } from '../methods';

const LAST_MODIFIED_HEADER = 'x-last-modified';

export type { GetSchoolYearConfigDto, PutSchoolYearConfigRowDto };

export type SchoolYearConfigQueryData = {
  rows: GetSchoolYearConfigDto[];
  lastModifiedOn: string | null;
};

export type UpdateSchoolYearConfigInput = {
  rows: PutSchoolYearConfigRowDto[];
  lastModifiedOn: string | null;
};

const QUERY_KEY = ['school-year-config'];

export const schoolYearConfigQueries = {
  queryKey: QUERY_KEY,
  queryFn: async () => {
    const res = await apiClientRaw.get<GetSchoolYearConfigDto[]>('/school-year-config');
    const headerValue = res.headers[LAST_MODIFIED_HEADER];
    return {
      rows: res.data ?? [],
      lastModifiedOn: Array.isArray(headerValue) ? headerValue[0] : (headerValue ?? null),
    } satisfies SchoolYearConfigQueryData;
  },
};

export const useUpdateSchoolYearConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, lastModifiedOn }: UpdateSchoolYearConfigInput) => {
      return apiClient.put('/school-year-config', rows, {
        headers: lastModifiedOn ? { [LAST_MODIFIED_HEADER]: lastModifiedOn } : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
};
