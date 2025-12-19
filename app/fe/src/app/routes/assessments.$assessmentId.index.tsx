import { createFileRoute } from '@tanstack/react-router';
import { JobViewPage } from '../Pages/Jobs/JobViewPage';

export const Route = createFileRoute('/assessments/$assessmentId/')({
  component: JobViewPage,
});
