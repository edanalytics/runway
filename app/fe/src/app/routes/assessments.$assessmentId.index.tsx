import { createFileRoute } from '@tanstack/react-router';
import { JobViewPage } from '../Pages/Jobs/JobViewPage';

/** `tab: 'students'` opens the job's Unmatched Students tab. */
type JobViewSearch = { tab?: 'students' };

export const Route = createFileRoute('/assessments/$assessmentId/')({
  validateSearch: (search: Record<string, unknown>): JobViewSearch =>
    search.tab === 'students' ? { tab: 'students' } : {},
  component: JobViewPage,
});
