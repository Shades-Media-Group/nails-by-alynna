import { BUILD } from '@/build-info';

/**
 * Whether the server has a different build from the one running: another version, or the same
 * version built again (a second deploy of the day's work).
 */
export async function newBuildOnServer(): Promise<boolean> {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return false;
    const live = (await response.json()) as { version?: unknown; builtAt?: unknown };
    if (typeof live.version !== 'string' || typeof live.builtAt !== 'string') return false;
    return live.version !== BUILD.version || live.builtAt !== BUILD.builtAt;
  } catch {
    return false;
  }
}

/** What the new service worker asks every open window (public/update-sw.js); answering means "I update myself". */
export const UPDATE_MESSAGE = 'nba:update-ready';

/** Screens where a reload could lose what the user is typing. */
export const BUSY_PATHS = /\/(book|login|signup|forgot-password|reset-password|profile|admin\/(services|team|settings|appointments\/new))/;

/** Just opened or back on screen this long ago: nothing started yet, so a reload goes unnoticed. */
const FRESH_MS = 8_000;

/**
 * A new version is ready: reload now when the app was just opened (and no form is open), else
 * offer "Update" and apply it the next time the app is hidden.
 */
export function reloadsAtOnce(path: string, msSinceShown: number): boolean {
  return msSinceShown < FRESH_MS && !BUSY_PATHS.test(path);
}
