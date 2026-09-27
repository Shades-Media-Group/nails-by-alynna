import { useEffect } from 'react';

function setBadge(count: number): void {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
  // Refused (no permission on iOS, a browser tab): the count stays in the app, that's all.
  const done = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  void done.catch(() => undefined);
}

/**
 * The number on the app's Home Screen icon, where the device supports it: the requests waiting
 * for an answer. Cleared at zero and when the staff screens close (signing out, the client app).
 */
export function useAppBadge(count: number | undefined): void {
  useEffect(() => {
    if (count !== undefined) setBadge(count);
  }, [count]);
  useEffect(() => () => setBadge(0), []);
}
