import { createFileRoute } from '@tanstack/react-router';
import { schoolYearWithConfigQueries } from '../api/queries/school-year-with-config.queries';
import { odsConfigQueries } from '../api';

export const Route = createFileRoute('/ods-configs/new')({
  loader: async ({ context: { queryClient } }) => {
    queryClient.prefetchQuery(schoolYearWithConfigQueries);
    queryClient.prefetchQuery(odsConfigQueries.getAll({}));
  },
  beforeLoad: () => ({ hideSideNav: true }),
});
