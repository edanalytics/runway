import { createFileRoute } from '@tanstack/react-router';
import { JobsPage } from '../Pages/Jobs/JobsPage';

export const Route = createFileRoute('/assessments/')({
  component: JobsPage,
});
