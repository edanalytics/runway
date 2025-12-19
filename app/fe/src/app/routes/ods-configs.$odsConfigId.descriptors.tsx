import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/ods-configs/$odsConfigId/descriptors')({
  component: () => <div>Hello /ods/new!</div>,
});
