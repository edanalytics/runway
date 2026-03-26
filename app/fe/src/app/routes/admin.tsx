import { createFileRoute } from '@tanstack/react-router';
import { AdminPage } from '../Pages/Admin/AdminPage';

export const Route = createFileRoute('/admin')({
  component: AdminPage,
  meta: () => [{ title: 'admin' }],
});
