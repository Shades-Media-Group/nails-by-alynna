/**
 * Leaves the app for another site in this tab, e.g. Google's consent screen, which sends people
 * back when they're done: a full page load, not a route change. In one place so tests can stand
 * in for it (a test page can't really navigate).
 */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
