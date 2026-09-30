import type { AppDeps } from '../../context';

/*
 * The HTTP side of connected calendars (Google Calendar API, iCloud CalDAV): plain fetch with a
 * timeout, and one error type that says what to do next. Tests put a stand-in for fetch here.
 */

export type CalendarFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const overrides = new WeakMap<AppDeps, CalendarFetch>();

/** Replaces fetch for one runtime's calendar calls (tests); null = the real one again. */
export function setCalendarFetch(deps: AppDeps, fetcher: CalendarFetch | null): void {
  if (fetcher) overrides.set(deps, fetcher);
  else overrides.delete(deps);
}

/** One call; every provider call gives up after this long. */
export const CALL_TIMEOUT_MS = 15_000;

/** Why a call failed, and what follows from it. */
export type CalendarFailure =
  /** The account stopped letting the studio in: the master connects again. */
  | 'auth'
  /** The dedicated calendar itself is gone (deleted there): it is made again. */
  | 'gone'
  /** A passing problem (network, rate limit, the provider down): tried again later. */
  | 'retry'
  /** The provider refused this one change: tried a few more times, far apart, then left. */
  | 'rejected';

export class CalendarError extends Error {
  constructor(
    readonly kind: CalendarFailure,
    message: string,
    /** How long the provider asked to wait (429 / 503 Retry-After). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'CalendarError';
  }
}

/** fetch with a timeout; a network failure becomes a passing CalendarError. */
export async function calendarFetch(deps: AppDeps, url: string | URL, init: RequestInit, label: string): Promise<Response> {
  const fetcher = overrides.get(deps) ?? fetch;
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (error) {
    throw new CalendarError('retry', `${label} unreachable (${(error as Error).name || 'network error'})`);
  }
}

/** The wait a 429 or 503 asks for (seconds, or a date), within an hour; none = undefined. */
export function retryAfterMs(response: Response, now: Date): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now.getTime();
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3_600_000) : undefined;
}

/** A passing failure for 429 and 5xx answers (with the wait the provider asked for). */
export function passingFailure(response: Response, now: Date, label: string): CalendarError | null {
  if (response.status !== 429 && response.status < 500) return null;
  // Rate limited without saying for how long: a minute.
  const wait = retryAfterMs(response, now) ?? (response.status === 429 ? 60_000 : undefined);
  return new CalendarError('retry', `${label} answered ${response.status}`, wait);
}
