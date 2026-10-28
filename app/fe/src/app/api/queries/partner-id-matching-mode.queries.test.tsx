/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { GetPartnerIdMatchingModeDto } from '@edanalytics/models';
import { methods } from '../methods';
import {
  partnerIdMatchingModeQuery,
  useUpdatePartnerIdMatchingMode,
} from './partner-id-matching-mode.queries';

jest.mock('../methods', () => ({ methods: { getOne: jest.fn(), put: jest.fn() } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('keeps the saved mode when an older GET completes afterward, without refetching', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const key = partnerIdMatchingModeQuery.queryKey;
  client.setQueryData(key, { idMatchingMode: 'fuzzy' });
  let finishOldGet!: (mode: GetPartnerIdMatchingModeDto) => void;
  jest.mocked(methods.getOne).mockReturnValue(
    new Promise<GetPartnerIdMatchingModeDto>((resolve) => {
      finishOldGet = resolve;
    })
  );
  jest.mocked(methods.put).mockResolvedValue({ idMatchingMode: 'id_based' });
  let save!: ReturnType<typeof useUpdatePartnerIdMatchingMode>['mutateAsync'];
  const Editor = () => {
    const { data } = useQuery(partnerIdMatchingModeQuery);
    save = useUpdatePartnerIdMatchingMode().mutateAsync;
    return <output>{data?.idMatchingMode}</output>;
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Editor />
        </QueryClientProvider>
      )
    );
    // Model a focus refetch which has read the old database value but is delayed in transit.
    const oldGet = client
      .fetchQuery({ ...partnerIdMatchingModeQuery, staleTime: 0 })
      .catch(() => undefined);
    await act(async () => {
      await save({ idMatchingMode: 'id_based' });
    });
    expect(client.getQueryData(key)).toEqual({ idMatchingMode: 'id_based' });
    await act(async () => {
      finishOldGet({ idMatchingMode: 'fuzzy' });
      await oldGet;
      // Drain QueryClient's scheduled observer notifications before checking the rendered value.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.getQueryData(key)).toEqual({ idMatchingMode: 'id_based' });
    expect(host.textContent).toBe('id_based');
    expect(methods.getOne).toHaveBeenCalledTimes(1);
    expect(methods.put).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    jest.clearAllMocks();
  }
});
