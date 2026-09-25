import { session, STORAGE_KEYS } from '@/lib/storage';

/**
 * The splash in index.html (Figma "App Prototype _Start") is painted before any JS runs.
 * It stays at least ~2.4 s on the first open of a session (the brand moment the studio asked
 * for) and ~0.7 s on reloads, then fades out once the first screen is ready.
 */
const FIRST_OPEN_MS = 2400;
const RELOAD_MS = 700;
let hidden = false;
let gone = typeof document === 'undefined' || !document.getElementById('splash');
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
