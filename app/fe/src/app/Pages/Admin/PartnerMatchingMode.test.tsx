/** @jest-environment jsdom */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRoot, Root } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { PartnerMatchingMode } from './PartnerMatchingMode';

let config = { idMatchingMode: 'id_based' };
let loading = false;
let pending = false;
let blocked = false;
let warn = false;
const proceed = jest.fn();
const reset = jest.fn();
const mutate =
  jest.fn<
    (body: unknown, options: { onSuccess: () => void; onError: (error: unknown) => void }) => void
  >();

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: config, isLoading: loading }),
}));
jest.mock('../../api/queries/partner-id-matching-mode.queries', () => ({
  partnerIdMatchingModeQuery: {},
  useUpdatePartnerIdMatchingMode: () => ({ mutate, isPending: pending }),
}));
jest.mock('@tanstack/react-router', () => ({
  useBlocker: ({ condition }: { condition: boolean }) => {
    warn = condition;
    return blocked ? { status: 'blocked', proceed, reset } : { status: 'idle' };
  },
}));
jest.mock('../../components/SupportButton', () => ({ ContactSupport: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('partner matching-mode editor', () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = async () =>
    act(async () => {
      root.render(
        <ChakraProvider>
          <PartnerMatchingMode />
        </ChakraProvider>
      );
    });
  const button = (label: string) => {
    const found = Array.from(document.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label
    );
    if (!found) throw new Error(`Missing button ${label}`);
    return found;
  };
  const click = async (label: string) =>
    act(async () => {
      button(label).click();
    });
  const choose = async (mode: string) =>
    act(async () => {
      const select = host.querySelector('select')!;
      select.value = mode;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  beforeEach(async () => {
    config = { idMatchingMode: 'id_based' };
    loading = pending = blocked = warn = false;
    jest.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await render();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('loads the saved mode and requires confirmation before sending only the mode', async () => {
    expect(host.textContent).toContain('ID-based');
    expect(host.textContent).toContain('new jobs');
    await click('edit');
    expect(Array.from(host.querySelectorAll('option')).map((o) => o.value)).toEqual([
      'id_based',
      'id_based_fuzzy_background',
      'fuzzy',
    ]);
    expect(button('save').disabled).toBe(true);
    await choose('fuzzy');
    expect(warn).toBe(true);
    await click('save');
    expect(mutate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('ID-based → Fuzzy matching');
    await click('confirm');
    expect(mutate).toHaveBeenCalledWith({ idMatchingMode: 'fuzzy' }, expect.any(Object));
    pending = true;
    await render();
    expect(host.querySelector('select')!.disabled).toBe(true);
    expect(button('save').disabled).toBe(true);
    expect(button('cancel').disabled).toBe(true);
    await act(async () => {
      config = { idMatchingMode: 'fuzzy' };
      pending = false;
      mutate.mock.calls[0][1].onSuccess();
    });
    await render();
    expect(host.querySelector('select')).toBeNull();
    expect(host.textContent).toContain('Fuzzy matching');
    expect(warn).toBe(false);
  });

  it.each([
    ['idrs_not_ready', 'Server-provided configuration message'],
    ['identity_service_unavailable', 'Server-provided availability message'],
  ])('keeps the draft and shows the appropriate %s failure', async (code, expected) => {
    await click('edit');
    await choose('id_based_fuzzy_background');
    await click('save');
    await click('confirm');
    await act(async () => mutate.mock.calls[0][1].onError({ code, message: expected }));
    expect(host.querySelector('select')!.value).toBe('id_based_fuzzy_background');
    expect(host.textContent).toContain(expected);
    expect(warn).toBe(true);
    expect(button('save').disabled).toBe(false);
  });

  it.each([
    { code: 'unexpected_error', message: 'UPSTREAM-SENTINEL' },
    { code: 'idrs_not_ready' },
    { code: 'identity_service_unavailable', message: 42 },
    { code: 'idrs_not_ready', message: '' },
  ])('uses a generic fallback for an unrecognized or malformed error %j', async (failure) => {
    await click('edit');
    await choose('fuzzy');
    await click('save');
    await click('confirm');
    await act(async () => mutate.mock.calls[0][1].onError(failure));
    expect(host.textContent).toContain(
      'Something went wrong saving your changes. Please try again.'
    );
    expect(host.textContent).not.toContain('UPSTREAM-SENTINEL');
  });

  it('confirms discarding changes and retains the saved mode', async () => {
    await click('edit');
    await choose('fuzzy');
    await click('cancel');
    expect(document.body.textContent).toContain('Discard your unsaved');
    await click('discard');
    expect(host.querySelector('select')).toBeNull();
    expect(host.textContent).toContain('ID-based');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('warns before leaving unsaved changes and clears the warning after discarding', async () => {
    await click('edit');
    await choose('fuzzy');
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    blocked = true;
    await render();
    expect(document.body.textContent).toContain('unsaved');
    await click('leave');
    expect(proceed).toHaveBeenCalledTimes(1);
    blocked = false;
    await render();
    await click('cancel');
    await click('discard');
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('shows loading until configuration is available', async () => {
    loading = true;
    await render();
    expect(host.textContent).toContain('loading');
    expect(host.querySelector('select')).toBeNull();
  });
});
