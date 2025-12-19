import { UseQueryResult } from '@tanstack/react-query';

export const getEntityFromQuery = <R extends { displayName?: string | number }>(
  source: number | undefined,
  relations: Pick<UseQueryResult<Record<string | number, R>, unknown>, 'data'>
) => (source === undefined ? undefined : relations.data?.[source] || undefined);
