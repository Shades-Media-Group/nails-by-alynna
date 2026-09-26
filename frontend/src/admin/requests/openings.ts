import { useSyncExternalStore } from 'react';

/**
 * When the "New requests" sheet comes up: once per opening of the staff app. An opening is the
 * page load, or the app coming back to the screen after REOPEN_AFTER_MS or more away (a phone
 * app switched back to). Kept outside React, so going to the client app and back, or signing in
 * and out, is not a new opening.
 */
export const REOPEN_AFTER_MS = 30_000;

export interface SheetState {
  /** 1 for the page load, then +1 at each return after REOPEN_AFTER_MS away. */
  opening: number;
  /** When the current opening began: only requests fetched after it decide. */
  openedAt: number;
  /** "<user id>#<opening>" the sheet is done for: shown and closed, or nothing to show. */
  done: string | null;
  showing: boolean;
}

let state: SheetState = { opening: 1, openedAt: Date.now(), done: null, showing: false };
let hiddenAt: number | null = null;
let listening = false;
const listeners = new Set<() => void>();

function update(patch: Partial<SheetState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    hiddenAt ??= Date.now();
    return;
  }
  const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
  hiddenAt = null;
  if (away >= REOPEN_AFTER_MS) update({ opening: state.opening + 1, openedAt: Date.now() });
}

function subscribe(listener: () => void) {
  // Registered once and kept: time away counts on any screen, the client app's included.
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;

export function usePendingSheetState(): SheetState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export const pendingSheet = {
  show: () => update({ showing: true }),
  /** Closed, or nothing to show: not again until the next opening (`key` is the current one). */
  finish: (key: string) => update({ showing: false, done: key }),
  /** The staff screens closed under it (the session ended): decided again when they return. */
  hide: () => {
    if (state.showing) update({ showing: false });
  },
};
