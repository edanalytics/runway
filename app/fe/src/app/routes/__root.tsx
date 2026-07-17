import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { StandardLayout } from '../Layout/StandardLayout';
import { tenantSchoolYearConfigQuery } from '../api';

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  hideSideNav: boolean;
}>()({
  // Warm the cache for Nav, which reads tenant config but degrades gracefully if it's missing.
  loader: (opts) => opts.context.queryClient.prefetchQuery(tenantSchoolYearConfigQuery),
  component: StandardLayout,
  // TODO NotFound and Error components
});
