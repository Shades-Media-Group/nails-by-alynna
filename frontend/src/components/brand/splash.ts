import { session, STORAGE_KEYS } from '@/lib/storage';

/**
 * The splash in index.html (Figma "App Prototype _Start") is painted before any JS runs when
 * the app starts. It stays at least ~2.4 s (the brand moment the studio asked for), then fades
 * out once the first screen is ready. A page that comes back within the same session (an update
 * applied in the background, iOS reopening a paused app) skips it: the <head> gate
 * (splashGate.ts) hides it before the first paint, and it is removed here.
 */
const FIRST_OPEN_MS = 2400;
/** Reloads that the gate could not catch (e.g. a page cached before it existed): a short one. */
const RELOAD_MS = 700;
let hidden = false;
let gone = typeof document === 'undefined' || !document.getElementById('splash');
if (!gone && document.documentElement.getAttribute('data-splash') === 'skip') {
  document.getElementById('splash')?.remove();
  session.set(STORAGE_KEYS.splashSeen, '1');
  gone = true;
}
const listeners = new Set<() => void>();

/** True once the splash has faded out (overlays such as the consent card wait for it). */
export function isSplashGone(): boolean {
  return gone;
}

export function onSplashGone(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function markGone() {
  gone = true;
  listeners.forEach((listener) => listener());
}

export function hideSplash(): void {
  if (hidden) return;
  hidden = true;
  const splash = document.getElementById('splash');
  if (!splash) {
    markGone();
    return;
  }
  const minimum = session.get(STORAGE_KEYS.splashSeen) ? RELOAD_MS : FIRST_OPEN_MS;
  const wait = Math.max(0, minimum - performance.now());
  window.setTimeout(() => {
    session.set(STORAGE_KEYS.splashSeen, '1');
    splash.classList.add('is-leaving');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff');
    document.documentElement.style.background = '#ffffff';
    window.setTimeout(() => {
      splash.remove();
      markGone();
    }, 500);
  }, wait);
}
