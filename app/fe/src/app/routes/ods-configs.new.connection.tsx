import { createFileRoute } from '@tanstack/react-router';
import { OdsConfigConnectionCreatePage } from '../Pages/Ods/OdsConfigConnectionCreatePage';

export const Route = createFileRoute('/ods-configs/new/connection')({
  component: OdsConfigConnectionCreatePage,
});
