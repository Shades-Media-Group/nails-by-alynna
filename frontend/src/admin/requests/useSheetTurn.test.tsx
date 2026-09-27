import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideSplash } from '@/components/brand/splash';
import { SHEET_ORDER, joinSheetQueue, leaveSheetQueue } from '@/lib/sheetQueue';
import { useSheetTurn } from './useSheetTurn';

/*
 * The "new requests" sheet opens by itself when the staff app opens: it waits for the
 * notifications ask (lib/sheetQueue.ts) whether that one ends up opening or not.
 */

function Requests({ onTurn }: { onTurn: () => void }) {
  useSheetTurn('staff#1', onTurn);
  return null;
}

afterEach(() => {
  leaveSheetQueue('notifications');
  vi.useRealTimers();
});

describe('the requests sheet and the notifications ask', () => {
  it('waits while the notifications ask holds its place, then comes up a beat after it leaves', () => {
    vi.useFakeTimers();
    hideSplash(); // No splash element in tests: gone at once.
    joinSheetQueue('notifications', SHEET_ORDER.notifications);
    const onTurn = vi.fn();
    render(<Requests onTurn={onTurn} />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onTurn).not.toHaveBeenCalled();

    // Decided not to ask (notifications already on): it leaves without ever opening a dialog.
    act(() => {
      leaveSheetQueue('notifications');
      vi.advanceTimersByTime(400);
    });
    expect(onTurn).toHaveBeenCalledTimes(1);
  });
});
