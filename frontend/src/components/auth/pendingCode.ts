/**
 * The "enter the code" step survives a reload of the tab: people switch to their mail app to
 * read the code, and the phone may reload the app meanwhile (memory, an update). Kept in
 * sessionStorage (this tab only) for as long as a code is valid.
 */

export type CodeFlow = 'signup' | 'login' | 'reset';

export interface PendingCode {
  flow: CodeFlow;
  email: string;
  remember?: boolean;
  resendAfterSec?: number;
  at: number;
}

const KEY = 'nba:pending-code';
const MAX_AGE_MS = 10 * 60_000;

export function savePendingCode(pending: Omit<PendingCode, 'at'>): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...pending, at: Date.now() }));
  } catch {
    // Private mode or storage blocked: the step simply won't survive a reload.
  }
}

export function readPendingCode(flow: CodeFlow): PendingCode | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingCode>;
    if (pending.flow !== flow || typeof pending.email !== 'string' || typeof pending.at !== 'number') return null;
    if (Date.now() - pending.at > MAX_AGE_MS) return null;
    return pending as PendingCode;
  } catch {
    return null;
  }
}

export function clearPendingCode(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
