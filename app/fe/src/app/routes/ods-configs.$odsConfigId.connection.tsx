import { createFileRoute } from '@tanstack/react-router';
import { OdsConfigConnectionEditPage } from '../Pages/Ods/OdsConfigConnectionEditPage';

export const Route = createFileRoute('/ods-configs/$odsConfigId/connection')({
  component: OdsConfigConnectionEditPage,
});
