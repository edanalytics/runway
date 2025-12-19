import { createFileRoute } from '@tanstack/react-router';
import { JobConfirmSubmit } from '../Pages/Jobs/JobConfirmSubmit';

export const Route = createFileRoute('/assessments/$assessmentId/submitted')({
  component: JobConfirmSubmit,
  beforeLoad: () => ({ hideSideNav: true }),
});
