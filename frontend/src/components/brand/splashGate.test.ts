import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/lib/storage';
import { SPLASH_GATE_SCRIPT } from './splashGate';

// The script ships inline in index.html; here it runs the same way, as plain script text.
const runGate = () => new Function(SPLASH_GATE_SCRIPT)() as void;
const skipped = () => document.documentElement.getAttribute('data-splash') === 'skip';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.documentElement.removeAttribute('data-splash');
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
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#ffffff');
  });

  it('skips it on a reload even before the splash was ever marked as seen', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as unknown as PerformanceEntry]);
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
