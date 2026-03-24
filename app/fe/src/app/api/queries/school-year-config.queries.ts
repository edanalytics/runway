import {
  GetSchoolYearConfigDto,
  PutSchoolYearConfigRowDto,
} from '@edanalytics/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, apiClientRaw } from '../methods';

const ETAG_HEADER = 'etag';
const IF_MATCH_HEADER = 'if-match';

export type { GetSchoolYearConfigDto, PutSchoolYearConfigRowDto };

export type SchoolYearConfigQueryData = {
  rows: GetSchoolYearConfigDto[];
  etag: string | null;
};

export type UpdateSchoolYearConfigInput = {
  rows: PutSchoolYearConfigRowDto[];
  etag: string | null;
};

const QUERY_KEY = ['school-year-config'];

export const schoolYearConfigQueries = {
  queryKey: QUERY_KEY,
  queryFn: async () => {
    const res = await apiClientRaw.get<GetSchoolYearConfigDto[]>('/school-year-config');
    const headerValue = res.headers[ETAG_HEADER];
    return {
      rows: res.data ?? [],
      etag: Array.isArray(headerValue) ? headerValue[0] : (headerValue ?? null),
    } satisfies SchoolYearConfigQueryData;
  },
};

export const useUpdateSchoolYearConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, etag }: UpdateSchoolYearConfigInput) => {
      return apiClient.put('/school-year-config', rows, {
        headers: etag ? { [IF_MATCH_HEADER]: etag } : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
};
