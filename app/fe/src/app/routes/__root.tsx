import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { StandardLayout } from '../Layout/StandardLayout';

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  hideSideNav: boolean;
}>()({
  component: StandardLayout,
  // TODO NotFound and Error components
});
