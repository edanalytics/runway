import { createFileRoute, redirect } from '@tanstack/react-router';
import { tenantSchoolYearConfigQuery } from '../api';

export const Route = createFileRoute('/ods-configs')({
  // Guard the ODS configuration section at the parent level: if no enabled
  // year is configured to send to an ODS, the whole section is inapplicable,
  // so bounce to the home route (which will then route the user to the
  // appropriate setup-required message or onward to assessments).
  loader: async (opts) => {
    const yearConfigs = await opts.context.queryClient.ensureQueryData(
      tenantSchoolYearConfigQuery
    );
    const doesAnyYearSendToOds = yearConfigs.some((y) => y.sendToOds);
    if (!doesAnyYearSendToOds) {
      return redirect({ to: '/' });
    }
  },
  meta: () => [{ title: 'ODS Configuration' }], // title lives here so it's available for breadcrumb even on child routes.
});
