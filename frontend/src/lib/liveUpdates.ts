import type { QueryClient } from '@tanstack/react-query';

/** The message public/push-sw.js posts to every open window when a push arrives. */
export const PUSH_MESSAGE = 'nba:push';
/** …and to the open app when a tapped notification's page can't be opened by the worker itself. */
export const NAVIGATE_MESSAGE = 'nba:navigate';

/** Studio data a push never changes; everything else is the signed-in person's own. */
const STATIC = new Set(['config', 'catalog', 'staff']);

/**
 * A push means something changed for this person (a booking confirmed, moved or cancelled, a
 * reward coming up): the data on screen is fetched again at once, instead of at the next 30 s
 * refresh (LIVE in services/queries.ts). A tapped notification that the service worker could not
 * open in this window arrives as a page to go to (`navigate`, e.g. the router's). Called once,
 * at start-up.
 */
export function listenForPushes(client: QueryClient, navigate?: (path: string) => void): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; url?: unknown } | null;
    if (data?.type === PUSH_MESSAGE) {
      void client.invalidateQueries({
        predicate: (query) => !STATIC.has(String(query.queryKey[0])),
      });
      return;
    }
    if (data?.type === NAVIGATE_MESSAGE && typeof data.url === 'string' && navigate) {
      let target: URL;
      try {
        target = new URL(data.url, window.location.origin);
      } catch {
        return;
      }
      // Only ever a page of this app.
      if (target.origin !== window.location.origin) return;
      navigate(`${target.pathname}${target.search}${target.hash}`);
    }
  });
}
