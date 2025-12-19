import { createFileRoute } from '@tanstack/react-router';
import { jobQueries } from '../api/queries/job.queries';
import { handleLoaderError } from '@edanalytics/common-ui';

export const Route = createFileRoute('/assessments/$assessmentId')({
  loader: async (opts) =>
    opts.context.queryClient
      .ensureQueryData({
        ...jobQueries.getOne({ id: opts.params.assessmentId }),
      })
      .catch(handleLoaderError),
});
