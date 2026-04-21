import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { StandardLayout } from '../Layout/StandardLayout';
import { tenantSchoolYearConfigQuery } from '../api';

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  hideSideNav: boolean;
}>()({
  // Warm Nav's tenant config read; prefetchQuery so an outage doesn't tank
  // every route — ODS routes, /, and /assessments/new ensureQueryData it.
  loader: (opts) => opts.context.queryClient.prefetchQuery(tenantSchoolYearConfigQuery),
  component: StandardLayout,
  // TODO NotFound and Error components
});
