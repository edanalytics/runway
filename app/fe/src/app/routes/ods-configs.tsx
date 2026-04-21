import { createFileRoute, redirect } from '@tanstack/react-router';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';

export const Route = createFileRoute('/ods-configs')({
  loader: async (opts) => {
    const yearConfigs = await opts.context.queryClient.fetchQuery(tenantSchoolYearConfigQuery);
    const doesAnyYearSendToOds = yearConfigs.some((y) => y.sendToOds);
    if (!doesAnyYearSendToOds) {
      return redirect({ to: '/' });
    }
  },
  meta: () => [{ title: 'ODS Configuration' }], // title lives here so it's available for breadcrumb even on child routes.
});
