import { createFileRoute, redirect } from '@tanstack/react-router';
import { OdsConfigsPage } from '../Pages/Ods/OdsConfigsPage';
import { Suspense } from 'react';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';

export const Route = createFileRoute('/ods-configs/')({
  loader: async (opts) => {
    const yearConfigs = await opts.context.queryClient.fetchQuery(tenantSchoolYearConfigQuery);
    const anyYearSendsToOds = yearConfigs.some((y) => y.sendToOds);
    if (!anyYearSendsToOds) {
      return redirect({ to: '/' });
    }
  },
  component: () => (
    <Suspense>
      <OdsConfigsPage />
    </Suspense>
  ),
});
