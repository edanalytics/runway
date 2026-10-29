import {
  GetPartnerConfigDto,
  GetPartnerIdMatchingModeDto,
  PutPartnerConfigDto,
  PutPartnerIdMatchingModeDto,
} from '@edanalytics/models';
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
      queryClient.invalidateQueries({ queryKey: ['school-year-config', 'tenant'] }); // update list of available school years
    },
  });
};

// Tech debt: /partners/config holds only cross-year matching, so the matching
// mode has its own resource rather than a second field there, where saving one
// setting would overwrite the other. Rationalize these into specifically named
// resources, or into one config with the 409 stale-write check the school-year
// config has.
const ID_MATCHING_MODE_QUERY_KEY = ['partner-id-matching-mode'];

export const partnerIdMatchingModeQuery = {
  queryKey: ID_MATCHING_MODE_QUERY_KEY,
  queryFn: () => methods.getOne('/partners/id-matching-mode', GetPartnerIdMatchingModeDto),
};

export const useUpdatePartnerIdMatchingMode = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: PutPartnerIdMatchingModeDto) => {
      return apiClient.put('/partners/id-matching-mode', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ID_MATCHING_MODE_QUERY_KEY });
    },
  });
};
