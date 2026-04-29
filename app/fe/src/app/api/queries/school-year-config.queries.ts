import {
  GetSchoolYearConfigDto,
  GetTenantSchoolYearConfigDto,
  PutSchoolYearConfigRowDto,
} from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, apiClientRaw, methods } from '../methods';

const QUERY_KEY = ['school-year-config'];

export const schoolYearConfigQuery = {
  queryKey: QUERY_KEY,
  queryFn: async () => {
    const res = await apiClientRaw.get<GetSchoolYearConfigDto[]>('/school-year-config');
    const headerValue = res.headers['x-config-modified-at'];
    return {
      rows: plainToInstance(GetSchoolYearConfigDto, res.data ?? []),
      modifiedAt: Array.isArray(headerValue) ? headerValue[0] : (headerValue ?? null),
    } satisfies { rows: GetSchoolYearConfigDto[]; modifiedAt: string | null };
  },
};

export const tenantSchoolYearConfigQuery = {
  queryKey: [...QUERY_KEY, 'tenant'],
  queryFn: () => methods.getMany('/school-year-config/tenant', GetTenantSchoolYearConfigDto),
};

export const useUpdateSchoolYearConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rows,
      modifiedAt,
    }: {
      rows: PutSchoolYearConfigRowDto[];
      modifiedAt: string | null;
    }) => {
      return apiClient.put('/school-year-config', rows, {
        headers: modifiedAt ? { 'x-if-config-modified-at': modifiedAt } : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
};
