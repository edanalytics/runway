import { createFileRoute, redirect } from '@tanstack/react-router';
import { OdsConfigConnectionEditPage } from '../Pages/Ods/OdsConfigConnectionEditPage';
import { odsConfigQueries } from '../api';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';

export const Route = createFileRoute('/ods-configs/$odsConfigId/connection')({
  loader: async (opts) => {
    const [odsConfig, yearConfigs] = await Promise.all([
      opts.context.queryClient.fetchQuery(
        odsConfigQueries.getOne({ id: opts.params.odsConfigId })
      ),
      opts.context.queryClient.fetchQuery(tenantSchoolYearConfigQuery),
    ]);
    const yearConfig = yearConfigs.find((y) => y.schoolYearId === odsConfig.schoolYearId);
    if (!yearConfig?.sendToOds) {
      return redirect({ to: '/ods-configs' });
    }
  },
  component: OdsConfigConnectionEditPage,
});
