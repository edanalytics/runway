import {
  GetSchoolYearConfigDto,
  GetTenantSchoolYearConfigDto,
  PutSchoolYearConfigRowDto,
} from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, apiClientRaw, methods } from '../methods';

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
  tenant: {
    queryKey: [...QUERY_KEY, 'tenant'],
    queryFn: () => methods.getMany('/school-year-config/tenant', GetTenantSchoolYearConfigDto),
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
    },
  });
};
