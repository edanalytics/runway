import { createFileRoute } from '@tanstack/react-router';
import { OdsConfigsPage } from '../Pages/Ods/OdsConfigsPage';
import { Suspense } from 'react';

export const Route = createFileRoute('/ods-configs/')({
  component: () => (
    <Suspense>
      <OdsConfigsPage />
    </Suspense>
  ),
});
