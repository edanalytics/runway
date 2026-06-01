import { createFileRoute, redirect } from '@tanstack/react-router';
import { meQuery } from '../api/queries/me.queries';
import { AdminPage } from '../Pages/Admin/AdminPage';

export const Route = createFileRoute('/admin')({
  loader: async (opts) => {
    const me = await opts.context.queryClient.ensureQueryData(meQuery);
    const isPartnerAdmin = me?.roles?.includes('PartnerAdmin') ?? false;
    if (!isPartnerAdmin) {
      return redirect({ to: '/' });
    }
  },
  component: AdminPage,
  meta: () => [{ title: 'admin' }],
});
