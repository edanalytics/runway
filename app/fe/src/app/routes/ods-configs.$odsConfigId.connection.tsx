import { createFileRoute, redirect } from '@tanstack/react-router';
import { OdsConfigConnectionEditPage } from '../Pages/Ods/OdsConfigConnectionEditPage';
import { odsConfigQueries } from '../api';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';

export const Route = createFileRoute('/ods-configs/$odsConfigId/connection')({
  // Prevent editing an ODS config for a year that isn't configured to send to
  // an ODS. This can happen if the tenant's school year config changed after
  // the ODS was created, or via URL manipulation. Redirect to the ODS
  // configuration list (which itself redirects home if no year sends to ODS).
  loader: async (opts) => {
    const [odsConfig, yearConfigs] = await Promise.all([
      opts.context.queryClient.ensureQueryData(
        odsConfigQueries.getOne({ id: opts.params.odsConfigId })
      ),
      opts.context.queryClient.ensureQueryData(tenantSchoolYearConfigQuery),
    ]);
    const yearConfig = yearConfigs.find((y) => y.schoolYearId === odsConfig.schoolYearId);
    if (!yearConfig?.sendToOds) {
      return redirect({ to: '/ods-configs' });
    }
  },
  component: OdsConfigConnectionEditPage,
});
