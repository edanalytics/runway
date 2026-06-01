import { GetPartnerConfigDto, PutPartnerConfigDto } from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, apiClientRaw } from '../methods';

const QUERY_KEY = ['partner-config'];

export const partnerConfigQuery = {
  queryKey: QUERY_KEY,
  queryFn: async () => {
    const res = await apiClientRaw.get<GetPartnerConfigDto>('/partners/config');
    const headerValue = res.headers['x-config-modified-at'];
    return {
      config: plainToInstance(GetPartnerConfigDto, res.data),
      modifiedAt: Array.isArray(headerValue) ? headerValue[0] : (headerValue ?? null),
    } satisfies { config: GetPartnerConfigDto; modifiedAt: string | null };
  },
};

export const useUpdatePartnerConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      body,
      modifiedAt,
    }: {
      body: PutPartnerConfigDto;
      modifiedAt: string | null;
    }) => {
      return apiClient.put('/partners/config', body, {
        headers: modifiedAt ? { 'x-if-config-modified-at': modifiedAt } : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
};
