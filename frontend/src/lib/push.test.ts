import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationsApi } from '@/services/api/endpoints';
import { PushSubscribeError, enablePush, resyncPush, softAskFor, type DeviceState, urlBase64ToUint8Array } from './push';
import { storage } from './storage';

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

describe('resyncPush on every start', () => {
  const SERVER_KEY = 'BPUBLICKEY';
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    storage.remove('nba:push-owner');
  });

  /** A phone that allowed notifications, holding a subscription made with `key`. */
  function phoneSubscribedWith(key: string) {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
    vi.stubGlobal('PushManager', class {});
    const subscription = (endpoint: string, withKey: string) => ({
      endpoint,
      expirationTime: null,
      options: { applicationServerKey: urlBase64ToUint8Array(withKey).buffer },
      toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: vi.fn(async () => true),
    });
    const current = subscription('https://web.push.apple.com/old', key);
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => current),
        subscribe: vi.fn(async () => subscription('https://web.push.apple.com/new', SERVER_KEY)),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration) } });
    vi.spyOn(notificationsApi, 'publicKey').mockResolvedValue(SERVER_KEY);
    const posted = vi.spyOn(notificationsApi, 'subscribe').mockResolvedValue({ ok: true });
    return { registration, current, posted };
  }

  it("gives a staff member back their phone's notifications, after someone else used it", async () => {
    const { posted } = phoneSubscribedWith(SERVER_KEY);
    storage.set('nba:push-owner', 'test-client');
    // A client account is not moved over silently…
    await resyncPush('another-client');
    expect(posted).not.toHaveBeenCalled();
    // …the master opening the staff app is.
    await resyncPush('master', { staff: true });
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://web.push.apple.com/old' }));
    expect(storage.get('nba:push-owner')).toBe('master');
  });

  it('replaces a subscription made with an older server key, which could receive nothing', async () => {
    const { registration, current, posted } = phoneSubscribedWith('BOLDERKEYX');
    storage.set('nba:push-owner', 'master');
    await resyncPush('master', { staff: true });
    expect(current.unsubscribe).toHaveBeenCalled();
    expect(registration.pushManager.subscribe).toHaveBeenCalled();
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://web.push.apple.com/new' }));
  });
});
