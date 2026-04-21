import { createFileRoute } from '@tanstack/react-router';
import { OdsConfigsPage } from '../Pages/Ods/OdsConfigsPage';
import { odsConfigQueries } from '../api';

export const Route = createFileRoute('/ods-configs/')({
  loader: (opts) => opts.context.queryClient.ensureQueryData(odsConfigQueries.getAll({})),
  component: OdsConfigsPage,
});
