/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LastAction, LastActionBar } from './studentPane';
import { DecisionResult } from './reviewSession';

jest.mock('./reviewSession', () => ({
  useReviewSession: () => ({
    students: [{ correlationId: 'student', sendRunId: null }],
  }),
}));
jest.mock('../../../api/queries/me.queries', () => ({ useMe: () => ({}) }));
jest.mock('../../../components/SupportButton', () => ({ ContactSupport: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('decision Undo', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const undoButton = (host: HTMLDivElement) => {
    const button = host.querySelector('button');
    if (!button) throw new Error('Undo button missing');
    return button;
  };

  it.each<DecisionResult>([
    { ok: true, version: null },
    { ok: false, message: 'The decision changed.' },
  ])('keeps a newer action independent of an older Undo response: %j', async (result) => {
    let finish!: (result: DecisionResult) => void;
    const pending = new Promise<DecisionResult>((resolve) => {
      finish = resolve;
    });
    const onDismiss = jest.fn();
    const oldAction: LastAction = {
      correlationId: 'student',
      message: 'Old save',
      advance: false,
      undo: () => pending,
    };
    const newAction: LastAction = { ...oldAction, message: 'New save' };

    await act(async () => root.render(<LastActionBar action={oldAction} onDismiss={onDismiss} />));
    await act(async () => undoButton(host).click());
    expect(undoButton(host).disabled).toBe(true);

    await act(async () => root.render(<LastActionBar action={newAction} onDismiss={onDismiss} />));
    expect(undoButton(host).disabled).toBe(false);

    await act(async () => finish(result));
    expect(host.textContent).toContain('New save');
    expect(host.textContent).not.toContain("Couldn't undo");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores a response after the old banner was dismissed and another was opened', async () => {
    let finish!: (result: DecisionResult) => void;
    const pending = new Promise<DecisionResult>((resolve) => {
      finish = resolve;
    });
    const onDismiss = jest.fn();
    const action: LastAction = {
      correlationId: 'student',
      message: 'Old save',
      advance: false,
      undo: () => pending,
    };
    await act(async () => root.render(<LastActionBar action={action} onDismiss={onDismiss} />));
    await act(async () => undoButton(host).click());
    await act(async () => root.render(null));
    await act(async () =>
      root.render(
        <LastActionBar action={{ ...action, message: 'New save' }} onDismiss={onDismiss} />
      )
    );

    await act(async () => finish({ ok: true, version: null }));
    expect(host.textContent).toContain('New save');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it.each<DecisionResult>([
    { ok: true, version: null },
    { ok: false, message: 'The decision changed.' },
  ])('handles the current action’s Undo response: %j', async (result) => {
    const onDismiss = jest.fn();
    const action: LastAction = {
      correlationId: 'student',
      message: 'Saved',
      advance: false,
      undo: async () => result,
    };
    await act(async () => root.render(<LastActionBar action={action} onDismiss={onDismiss} />));
    await act(async () => undoButton(host).click());

    if (result.ok) expect(onDismiss).toHaveBeenCalledTimes(1);
    else {
      expect(onDismiss).not.toHaveBeenCalled();
      expect(host.textContent).toContain(`Couldn't undo that: ${result.message}`);
    }
  });
});
