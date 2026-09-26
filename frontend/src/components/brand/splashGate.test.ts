import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/lib/storage';
import { SPLASH_GATE_SCRIPT } from './splashGate';

// The script ships inline in index.html; here it runs the same way, as plain script text.
const runGate = () => new Function(SPLASH_GATE_SCRIPT)() as void;
const skipped = () => document.documentElement.getAttribute('data-splash') === 'skip';
const statusBar = () => document.documentElement.style.getPropertyValue('--splash-status-bar');

/** A device: iOS reports the screen in portrait; the page's size follows the orientation. */
function device({
  standalone,
  screen,
  page,
}: {
  standalone?: boolean;
  screen: [number, number];
  page: [number, number];
}) {
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone });
  Object.defineProperty(window.screen, 'width', { configurable: true, value: screen[0] });
  Object.defineProperty(window.screen, 'height', { configurable: true, value: screen[1] });
  vi.stubGlobal('innerWidth', page[0]);
  vi.stubGlobal('innerHeight', page[1]);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of ['width', 'height']) Reflect.deleteProperty(window.screen, key);
  Reflect.deleteProperty(navigator, 'standalone');
  sessionStorage.clear();
  document.documentElement.removeAttribute('data-splash');
  document.documentElement.removeAttribute('style');
  document.head.innerHTML = '';
});

describe('splash gate', () => {
  it('lets the splash play when the app starts', () => {
    runGate();
    expect(skipped()).toBe(false);
  });

  it('skips it when the page comes back within the same session', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#FDE7FC">';
    sessionStorage.setItem(STORAGE_KEYS.splashSeen, '1');
    runGate();
    expect(skipped()).toBe(true);
    // The status bar matches the app, not the blush splash.
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#ffffff',
    );
  });

  it('skips it on a reload even before the splash was ever marked as seen', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'reload' } as unknown as PerformanceEntry,
    ]);
    runGate();
    expect(skipped()).toBe(true);
  });

  it('shows it (and never throws) when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(runGate).not.toThrow();
    expect(skipped()).toBe(false);
  });
});

describe('splash gate: the splash lines up with the iOS launch image', () => {
  it('measures the status bar the Home Screen app lays the page out below', () => {
    // iPhone 17 Pro: an 874 pt screen, the page laid out below the 62 pt status bar.
    device({ standalone: true, screen: [402, 874], page: [402, 812] });
    runGate();
    expect(statusBar()).toBe('62px');
  });

  it('measures the screen in the current orientation', () => {
    // Landscape iPhone: no status bar, the page is the whole screen.
    device({ standalone: true, screen: [402, 874], page: [874, 402] });
    runGate();
    expect(statusBar()).toBe('');
    // Landscape iPad: the 24 pt status bar stays.
    device({ standalone: true, screen: [820, 1180], page: [1180, 796] });
    runGate();
    expect(statusBar()).toBe('24px');
  });

  it('leaves a browser tab alone: there is no launch image to line up with', () => {
    device({ standalone: false, screen: [402, 874], page: [402, 714] });
    runGate();
    expect(statusBar()).toBe('');
  });

  it('leaves an iPad app in a window alone: that gap is no status bar', () => {
    device({ standalone: true, screen: [820, 1180], page: [700, 700] });
    runGate();
    expect(statusBar()).toBe('');
  });

  it('does nothing when the splash is skipped', () => {
    sessionStorage.setItem(STORAGE_KEYS.splashSeen, '1');
    device({ standalone: true, screen: [402, 874], page: [402, 812] });
    runGate();
    expect(skipped()).toBe(true);
    expect(statusBar()).toBe('');
  });
});
