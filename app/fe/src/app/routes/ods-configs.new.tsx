import { createFileRoute } from '@tanstack/react-router';
import { schoolYearQueries } from '../api/queries/school-year.queries';
import { odsConfigQueries } from '../api';

export const Route = createFileRoute('/ods-configs/new')({
  loader: async ({ context: { queryClient } }) => {
    queryClient.prefetchQuery(schoolYearQueries.getAll({}));
    queryClient.prefetchQuery(odsConfigQueries.getAll({}));
  },
  beforeLoad: () => ({ hideSideNav: true }),
});
