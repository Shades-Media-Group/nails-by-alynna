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
