import { useEffect, useSyncExternalStore } from 'react';

/**
 * One sheet at a time for sheets that open by themselves (the notifications ask, the staff
 * app's pending requests…), so they never stack. A sheet joins the queue as soon as it may
 * want to open (also while it is still deciding), opens only when it is in front, and leaves
 * when it closes or decides not to open. Lower `order` goes first; equal orders keep arrival.
 *
 *   const myTurn = useSheetTurn('pending-requests', 10, hasPending);
 *   <Sheet open={hasPending && myTurn} onClose={…} />   // leaves the queue once hasPending is false
 */
export const SHEET_ORDER = {
  /** The notifications ask (PushPrompt) goes before any other sheet. */
  notifications: 0,
  /** Good news for a client: a visit confirmed, a new stamp. */
  celebration: 5,
} as const;

interface Entry {
  id: string;
  order: number;
  seq: number;
}

let entries: Entry[] = [];
let arrivals = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Takes a place in the queue (again a no-op while in it); returns how to leave it. */
export function joinSheetQueue(id: string, order: number): () => void {
  if (!entries.some((entry) => entry.id === id)) {
    entries = [...entries, { id, order, seq: arrivals++ }];
    emit();
  }
  return () => leaveSheetQueue(id);
}

export function leaveSheetQueue(id: string): void {
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return;
  entries = next;
  emit();
}

/** The sheet whose turn it is, if any. */
export function sheetInFront(): string | null {
  let front: Entry | null = null;
  for (const entry of entries) {
    if (
      !front ||
      entry.order < front.order ||
      (entry.order === front.order && entry.seq < front.seq)
    )
      front = entry;
  }
  return front?.id ?? null;
}

export function subscribeSheetQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether sheet `id` may open now. It waits in the queue for as long as `wanted` is true. */
export function useSheetTurn(id: string, order: number, wanted: boolean): boolean {
  useEffect(() => (wanted ? joinSheetQueue(id, order) : undefined), [id, order, wanted]);
  const front = useSyncExternalStore(subscribeSheetQueue, sheetInFront, sheetInFront);
  return wanted && front === id;
}
