import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/ods-configs')({
  meta: () => [{ title: 'ODS Configuration' }], // title lives here so it's available for breadcrumb even on child routes.
});
