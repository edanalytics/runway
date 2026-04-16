import { createFileRoute, redirect } from '@tanstack/react-router';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';
import { LandingPage } from '../Pages/Home/LandingPage';

export const Route = createFileRoute('/')({
  loader: async (opts) => {
    const yearConfigs = await opts.context.queryClient.fetchQuery(tenantSchoolYearConfigQuery);

    const canProceed = yearConfigs.some((y) => y.hasOds || y.hasRoster === true);
    if (canProceed) {
      return redirect({ to: '/assessments' });
    }
  },
  component: LandingPage,
  beforeLoad: () => ({ hideSideNav: true }),
  meta: () => [{ title: 'Home' }],
});
