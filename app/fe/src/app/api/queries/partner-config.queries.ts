import { GetPartnerConfigDto, PutPartnerConfigDto } from '@edanalytics/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, methods } from '../methods';

const QUERY_KEY = ['partner-config'];

export const partnerConfigQuery = {
  queryKey: QUERY_KEY,
  queryFn: () => methods.getOne('/partners/config', GetPartnerConfigDto),
};

export const useUpdatePartnerConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: PutPartnerConfigDto) => {
      return apiClient.put('/partners/config', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
};
