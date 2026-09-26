import type { QueryClient } from '@tanstack/react-query';

/** The message public/push-sw.js posts to every open window when a push arrives. */
export const PUSH_MESSAGE = 'nba:push';

/** Studio data a push never changes; everything else is the signed-in person's own. */
const STATIC = new Set(['config', 'catalog', 'staff']);

/**
 * A push means something changed for this person (a booking confirmed, moved or cancelled, a
 * reward coming up): the data on screen is fetched again at once, instead of at the next 30 s
 * refresh (LIVE in services/queries.ts). Called once, at start-up.
 */
export function listenForPushes(client: QueryClient): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if ((event.data as { type?: unknown } | null)?.type !== PUSH_MESSAGE) return;
    void client.invalidateQueries({ predicate: (query) => !STATIC.has(String(query.queryKey[0])) });
  });
}
