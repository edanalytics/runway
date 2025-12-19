import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/ods-configs/$odsConfigId')({
  beforeLoad: () => ({ hideSideNav: true }),
});
