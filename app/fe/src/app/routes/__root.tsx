import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { StandardLayout } from '../Layout/StandardLayout';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  hideSideNav: boolean;
}>()({
  // Prefetch so Nav can render its sendToOds-dependent links on first paint
  // without flicker. Subsequent navigations hit the cache.
  loader: (opts) => opts.context.queryClient.ensureQueryData(tenantSchoolYearConfigQuery),
  component: StandardLayout,
  // TODO NotFound and Error components
});
