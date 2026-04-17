import { useParams } from '@tanstack/react-router';
import { odsConfigQueries } from '../../api';
import { OdsConfigConnectionEditForm } from './ConnectionForm/OdsConfigConnectionEditForm';
import { useSuspenseQuery } from '@tanstack/react-query';

export const OdsConfigConnectionEditPage = () => {
  const { odsConfigId } = useParams({ from: '/ods-configs/$odsConfigId/connection' });
  const { data: odsConfig } = useSuspenseQuery(odsConfigQueries.getOne({ id: odsConfigId }));

  return <OdsConfigConnectionEditForm odsConfig={odsConfig} />;
};
