import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/assessments')({
  meta: () => [{ title: 'assessments' }],
});
