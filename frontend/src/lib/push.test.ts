import { afterEach, describe, expect, it, vi } from 'vitest';
import { PushSubscribeError, enablePush, softAskFor, type DeviceState } from './push';

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

describe('enablePush when the system refuses the subscription', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  /** A browser that allowed notifications, with a service worker whose subscribe() fails with `error`. */
  function browserWhoseSubscribeFails(error: unknown) {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    vi.stubGlobal('PushManager', class {});
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => Promise.reject(error)),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve(registration) },
    });
    return registration;
  }

  it('reads a refusal (allowed in the page, off in the phone settings) as blocked', async () => {
    browserWhoseSubscribeFails(new DOMException('User denied push permission', 'NotAllowedError'));
    await expect(enablePush('u1', { publicKey: 'BPUBLICKEY' })).resolves.toBe('denied');
  });

  it('reports any other failure as a subscription problem, with the cause', async () => {
    browserWhoseSubscribeFails(
      new DOMException('Registration failed - push service error', 'AbortError'),
    );
    const failure = enablePush('u1', { publicKey: 'BPUBLICKEY' });
    await expect(failure).rejects.toBeInstanceOf(PushSubscribeError);
    await expect(failure).rejects.toThrow('AbortError: Registration failed - push service error');
  });
});
