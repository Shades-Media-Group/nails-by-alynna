import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SHEET_ORDER,
  joinSheetQueue,
  leaveSheetQueue,
  sheetInFront,
  useSheetTurn,
} from './sheetQueue';

/*
 * Sheets that open by themselves take turns: the notifications ask first, anything else
 * (e.g. the staff app's pending requests) after it has closed.
 */

afterEach(() => {
  for (const id of ['notifications', 'pending-requests', 'other']) leaveSheetQueue(id);
});

describe('sheet queue', () => {
  it('lets the lowest order go first, then arrival order', () => {
    joinSheetQueue('pending-requests', 10);
    expect(sheetInFront()).toBe('pending-requests');
    const leave = joinSheetQueue('notifications', SHEET_ORDER.notifications);
    expect(sheetInFront()).toBe('notifications');
    joinSheetQueue('other', 10);
    leave();
    expect(sheetInFront()).toBe('pending-requests');
    leaveSheetQueue('pending-requests');
    expect(sheetInFront()).toBe('other');
  });

  it('keeps a second sheet waiting until the first one leaves', () => {
    function Probe({ id, order, wanted }: { id: string; order: number; wanted: boolean }) {
      const turn = useSheetTurn(id, order, wanted);
      return <p data-testid={id}>{turn ? 'open' : 'waiting'}</p>;
    }
    const { rerender } = render(
      <>
        <Probe id="notifications" order={SHEET_ORDER.notifications} wanted />
        <Probe id="pending-requests" order={10} wanted />
      </>,
    );
    expect(screen.getByTestId('notifications')).toHaveTextContent('open');
    expect(screen.getByTestId('pending-requests')).toHaveTextContent('waiting');

    act(() => {
      rerender(
        <>
          <Probe id="notifications" order={SHEET_ORDER.notifications} wanted={false} />
          <Probe id="pending-requests" order={10} wanted />
        </>,
      );
    });
    expect(screen.getByTestId('notifications')).toHaveTextContent('waiting');
    expect(screen.getByTestId('pending-requests')).toHaveTextContent('open');
  });
});
