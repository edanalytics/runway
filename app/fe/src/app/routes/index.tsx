import { createFileRoute, redirect } from '@tanstack/react-router';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';
import { meQuery } from '../api/queries/me.queries';
import { SetupRequiredPage } from '../Pages/Home/SetupRequiredPage';

export const Route = createFileRoute('/')({
  loader: async (opts) => {
    const [yearConfigs, me] = await Promise.all([
      opts.context.queryClient.fetchQuery(tenantSchoolYearConfigQuery),
      opts.context.queryClient.fetchQuery(meQuery),
    ]);

    // Redirect to /assessments if the tenant has a usable year, or if the
    // viewer is a partner admin. The admin carve-out is there because it's
    // the admin who needs to enable years in the first place and define
    // whether jobs for those years are sent to an ODS.
    const isAnyYearReadyForJobs = yearConfigs.some((y) =>
      y.sendToOds ? y.hasOds : y.hasRoster === true
    );
    const isPartnerAdmin = me?.roles?.includes('PartnerAdmin') ?? false;
    if (isAnyYearReadyForJobs || isPartnerAdmin) {
      return redirect({ to: '/assessments' });
    }
  },
  component: SetupRequiredPage,
  beforeLoad: () => ({ hideSideNav: true }),
  meta: () => [{ title: 'Home' }],
});
