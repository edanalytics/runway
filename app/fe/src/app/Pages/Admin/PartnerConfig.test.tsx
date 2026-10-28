/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ChakraProvider } from '@chakra-ui/react';
import { PartnerConfig } from './PartnerConfig';

const saveCrossYear = jest.fn();
const saveMode = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === 'partner-config'
      ? { crossYearMatchingEnabled: false, canConnectToEdu: true }
      : { idMatchingMode: 'id_based' },
    isLoading: false,
  }),
}));
jest.mock('../../api/queries/partner-config.queries', () => ({
  partnerConfigQuery: { queryKey: ['partner-config'] },
  useUpdatePartnerConfig: () => ({ mutate: saveCrossYear, isPending: false }),
}));
jest.mock('../../api/queries/partner-id-matching-mode.queries', () => ({
  partnerIdMatchingModeQuery: { queryKey: ['partner-id-matching-mode'] },
  useUpdatePartnerIdMatchingMode: () => ({ mutate: saveMode, isPending: false }),
}));
jest.mock('@tanstack/react-router', () => ({ useBlocker: () => ({ status: 'idle' }) }));
jest.mock('../../components/SupportButton', () => ({ ContactSupport: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('partner configuration setting boundaries', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    jest.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<ChakraProvider><PartnerConfig /></ChakraProvider>));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const click = async (scope: ParentNode, name: string) => {
    const button = Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === name);
    if (!button) throw new Error(`Missing ${name} button`);
    await act(async () => button.click());
  };

  it.each(['cross-year', 'matching mode'])('edits and saves only the %s setting under one heading', async (setting) => {
    expect(Array.from(host.querySelectorAll('h3')).map((h) => h.textContent)).toEqual(['partner-wide configuration']);
    const crossYear = host.querySelector('section[aria-label="Cross-year roster for ID matching"]')!;
    const matching = host.querySelector('section[aria-label="Student identity matching mode"]')!;
    expect(crossYear).not.toBeNull();
    expect(matching).not.toBeNull();
    const row = setting === 'cross-year' ? crossYear : matching;
    const other = setting === 'cross-year' ? matching : crossYear;
    await click(row, 'edit');
    expect(other.querySelector('select, input')).toBeNull();
    expect(other.textContent).toContain('edit');
    if (setting === 'cross-year') {
      await act(async () => crossYear.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    } else {
      await act(async () => {
        const select = matching.querySelector('select')!;
        select.value = 'fuzzy';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await click(row, 'save');
    await click(document, 'confirm');
    const changed = setting === 'cross-year' ? saveCrossYear : saveMode;
    const untouched = setting === 'cross-year' ? saveMode : saveCrossYear;
    expect(changed).toHaveBeenCalledWith(setting === 'cross-year' ? { crossYearMatchingEnabled: true } : { idMatchingMode: 'fuzzy' }, expect.any(Object));
    expect(untouched).not.toHaveBeenCalled();
  });
});
