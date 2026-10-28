import { GetPartnerIdMatchingModeDto, PutPartnerIdMatchingModeDto } from '@edanalytics/models';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { methods } from '../methods';

const QUERY_KEY = ['partner-id-matching-mode'];
const URL = '/partners/id-matching-mode';

export const partnerIdMatchingModeQuery = {
  queryKey: QUERY_KEY,
  queryFn: () => methods.getOne(URL, GetPartnerIdMatchingModeDto),
};

export const useUpdatePartnerIdMatchingMode = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PutPartnerIdMatchingModeDto) =>
      methods.put(URL, PutPartnerIdMatchingModeDto, GetPartnerIdMatchingModeDto, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved);
    },
  });
};
