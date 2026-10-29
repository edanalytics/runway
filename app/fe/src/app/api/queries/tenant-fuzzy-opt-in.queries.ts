import { GetTenantFuzzyOptInsDto, PutTenantFuzzyOptInDto } from '@edanalytics/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, methods } from '../methods';

const QUERY_KEY = ['tenant-fuzzy-opt-ins'];

export type TenantFuzzyOptInChange = { tenantCode: string } & PutTenantFuzzyOptInDto;

export const tenantFuzzyOptInsQuery = {
  queryKey: QUERY_KEY,
  queryFn: () => methods.getOne('/partners/tenant-fuzzy-opt-ins', GetTenantFuzzyOptInsDto),
};

export const useUpdateTenantFuzzyOptIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenantCode, ...body }: TenantFuzzyOptInChange) => {
      return apiClient.put(
        `/partners/tenant-fuzzy-opt-ins/${encodeURIComponent(tenantCode)}`,
        body
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
};
