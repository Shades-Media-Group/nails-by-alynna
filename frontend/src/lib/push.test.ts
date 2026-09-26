import { describe, expect, it } from 'vitest';
import { softAskFor, type DeviceState } from './push';

/*
 * The gentle asks (after booking, top of Profile → Notifications) show a button only while a tap
 * can still turn notifications on, one line when only the phone can, and nothing otherwise.
 */

describe('softAskFor', () => {
  it('offers the button while notifications are off here (or the service worker is still installing)', () => {
    expect(softAskFor('off')).toBe('ask');
    expect(softAskFor('not-ready')).toBe('ask');
  });

  it('says what to do when only the phone can change it', () => {
    // iPhone in Safari: notifications need the app on the Home Screen.
    expect(softAskFor('needs-install')).toBe('install');
    // Blocked: one line on how to allow them again, no button that can't work.
    expect(softAskFor('denied')).toBe('blocked');
  });

  it('stays away when they are on, can never work here, or are not known yet', () => {
    const hidden: DeviceState[] = [
      'on',
      'unsupported',
      'no-service-worker',
      'unavailable',
      'loading',
    ];
    for (const state of hidden) expect(softAskFor(state)).toBeNull();
  });
});
