import { createFileRoute, redirect } from '@tanstack/react-router';
import { odsConfigQueries } from '../api';
import { NoOdsMessagePage } from '../Pages/Home/NoOdsMessagePage';

export const Route = createFileRoute('/')({
  loader: async (opts) => {
    const odsConfigs = await opts.context.queryClient.fetchQuery(odsConfigQueries.getAll({}));
    if (odsConfigs.length > 0) {
      return redirect({ to: '/assessments' });
    }
  },
  component: NoOdsMessagePage,
  beforeLoad: () => ({ hideSideNav: true }),
  meta: () => [{ title: 'Home' }],
});
