import { createFileRoute } from '@tanstack/react-router';
import { JobCreatePage } from '../Pages/Jobs/JobCreatePage';

export const Route = createFileRoute('/assessments/new')({
  component: JobCreatePage,
  beforeLoad: () => ({ hideSideNav: true }),
});
