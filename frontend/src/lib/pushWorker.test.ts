import { describe, expect, it, vi } from 'vitest';
import SOURCE from '../../public/push-sw.js?raw';

/*
 * public/push-sw.js, run as the service worker runs it (a plain script with `self`), against
 * fake push and click events. What matters most: every push shows a notification, whatever
 * arrives, or Safari takes notifications away from the app.
 */

const ORIGIN = 'https://nails.example.md';

interface FakeWindow {
  url: string;
  focused?: boolean;
  visibilityState?: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

function fakeWindow(url: string, extra: Partial<FakeWindow> = {}): FakeWindow {
  const win: FakeWindow = {
    url,
    focus: vi.fn(async () => win),
    navigate: vi.fn(async (href: string) => ({ ...win, url: href })),
    postMessage: vi.fn(),
    ...extra,
  };
  return win;
}

/** What the worker passes to showNotification (timestamp and renotify included). */
type Shown = NotificationOptions & { timestamp?: number; renotify?: boolean };
type ShowNotification = (title: string, options: Shown) => Promise<void>;

function worker({
  language = 'ro-RO',
  windows = [] as FakeWindow[],
  showNotification = vi.fn<ShowNotification>(async () => undefined),
  badging = {} as Record<string, unknown>,
} = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN },
    navigator: { language, ...badging },
    registration: { showNotification, pushManager: { subscribe: vi.fn() } },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (url: string) => ({ url })),
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
  };
  // A plain script, like importScripts(): its `self`, `console` and `fetch` are these fakes.
  new Function('self', 'console', 'fetch', SOURCE)(
    self,
    { error: vi.fn(), warn: vi.fn() },
    vi.fn(),
  );

  /** Dispatches like the browser: the handler must call waitUntil synchronously. */
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    listeners[type]!({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    expect(waits).toHaveLength(1);
    await Promise.all(waits);
  };
  const push = (data?: unknown) =>
    dispatch('push', {
      data:
        data === undefined
          ? null
          : {
              json: () => (typeof data === 'string' ? JSON.parse(data) : data),
              text: () => (typeof data === 'string' ? data : JSON.stringify(data)),
            },
    });
  const click = (url: unknown) =>
    dispatch('notificationclick', { notification: { data: { url }, close: vi.fn() } });
  return { self, showNotification, push, click };
}

describe('push-sw.js: every push shows a notification', () => {
  it('shows the message the API sends, grouped by visit, at the time it happened', async () => {
    const tab = fakeWindow(`${ORIGIN}/home`);
    const sw = worker({ windows: [tab] });
    await sw.push({
      title: 'Programare confirmată',
      body: 'Mâine, la 11:00',
      url: '/bookings/a1',
      tag: 'visit-a1',
      lang: 'ro',
      timestamp: 1_780_000_000_000,
    });
    expect(sw.showNotification).toHaveBeenCalledWith('Programare confirmată', {
      body: 'Mâine, la 11:00',
      icon: '/icons/pwa-192x192.png',
      badge: expect.stringMatching(/^data:image\/png;base64,/),
      lang: 'ro',
      data: { url: '/bookings/a1' },
      timestamp: 1_780_000_000_000,
      tag: 'visit-a1',
      renotify: true,
    });
    // The open app refreshes what it shows.
    expect(tab.postMessage).toHaveBeenCalledWith({ type: 'nba:push', tag: 'visit-a1' });
  });

  it('reads the declarative format alone (title, body, navigate)', async () => {
    const sw = worker();
    await sw.push({
      web_push: 8030,
      notification: {
        title: 'Visit moved',
        body: 'New time: 12:00',
        navigate: `${ORIGIN}/en/bookings/a1`,
        lang: 'en',
      },
    });
    expect(sw.showNotification).toHaveBeenCalledWith(
      'Visit moved',
      expect.objectContaining({
        body: 'New time: 12:00',
        lang: 'en',
        data: { url: `${ORIGIN}/en/bookings/a1` },
      }),
    );
  });

  it('falls back to the app name and a sentence in the phone language when the payload is empty or broken', async () => {
    const empty = worker({ language: 'ru-MD' });
    await empty.push();
    expect(empty.showNotification).toHaveBeenCalledWith(
      'Nails by Alynna',
      expect.objectContaining({
        body: 'У вас новое уведомление. Нажмите, чтобы открыть приложение.',
        data: { url: '/' },
      }),
    );
    const untagged = empty.showNotification.mock.calls[0]![1];
    expect(untagged.tag).toBeUndefined();
    expect(untagged.renotify).toBeUndefined();

    const text = worker({ language: 'en-GB' });
    await text.push('Your visit is tomorrow {not json');
    expect(text.showNotification).toHaveBeenCalledWith(
      'Nails by Alynna',
      expect.objectContaining({ body: 'Your visit is tomorrow {not json' }),
    );

    const wrongTypes = worker({ language: 'fr-FR' });
    await wrongTypes.push({ title: 42, body: ['x'], tag: {}, timestamp: 'soon' });
    const [title, options] = wrongTypes.showNotification.mock.calls[0]!;
    expect(title).toBe('Nails by Alynna');
    expect(options.body).toBe('Ai o noutate. Atinge ca să deschizi aplicația.');
    expect(options.timestamp).toBeGreaterThan(0);
  });

  it('still shows the words when the full notification is refused', async () => {
    const showNotification = vi.fn<ShowNotification>(async (_title, options) => {
      if (options.badge) throw new TypeError('badge not allowed');
    });
    const sw = worker({ showNotification });
    await sw.push({
      title: 'Reminder',
      body: 'Today at 11:00',
      url: '/bookings/a1',
      tag: 'visit-a1',
    });
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification).toHaveBeenLastCalledWith('Reminder', {
      body: 'Today at 11:00',
      data: { url: '/bookings/a1' },
    });
  });
});

describe('push-sw.js: tapping a notification', () => {
  it('opens the page when the app is closed, and never another site', async () => {
    const sw = worker();
    await sw.click('/bookings/a1');
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/bookings/a1`);
    await sw.click('https://evil.example.com/phish');
    expect(sw.self.clients.openWindow).toHaveBeenLastCalledWith(`${ORIGIN}/`);
  });

  it('brings the open app to the front on that page', async () => {
    const other = fakeWindow('https://elsewhere.example.com/');
    const app = fakeWindow(`${ORIGIN}/home`, { visibilityState: 'hidden' });
    const sw = worker({ windows: [other, app] });
    await sw.click('/bookings/a1');
    expect(app.focus).toHaveBeenCalled();
    expect(app.navigate).toHaveBeenCalledWith(`${ORIGIN}/bookings/a1`);
    expect(sw.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('asks the app to go there itself when the window cannot be navigated', async () => {
    const app = fakeWindow(`${ORIGIN}/home`, {
      navigate: vi.fn(async () => Promise.reject(new TypeError('not controlled'))),
    });
    const sw = worker({ windows: [app] });
    await sw.click('/loyalty');
    expect(app.postMessage).toHaveBeenCalledWith({
      type: 'nba:navigate',
      url: `${ORIGIN}/loyalty`,
    });
  });

  it('opens the page when focusing the app is refused', async () => {
    const app = fakeWindow(`${ORIGIN}/home`, {
      focus: vi.fn(async () => Promise.reject(new Error('InvalidAccessError'))),
    });
    const sw = worker({ windows: [app] });
    await sw.click('/bookings/a1');
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/bookings/a1`);
  });
});

describe('push-sw.js: the count on the app icon', () => {
  const badging = () => ({
    setAppBadge: vi.fn(async (_count?: number) => undefined),
    clearAppBadge: vi.fn(async () => undefined),
  });

  it('shows the requests waiting (staff), and clears it at 0', async () => {
    const api = badging();
    const sw = worker({ badging: api });
    await sw.push({
      title: 'New booking request',
      body: 'Ana · Tue 12:00',
      tag: 'staff-visit-A1',
      badge: 3,
    });
    expect(api.setAppBadge).toHaveBeenCalledWith(3);
    await sw.push({
      title: 'The client cancelled',
      body: 'Ana · Tue 12:00',
      tag: 'staff-visit-A1',
      badge: 0,
    });
    expect(api.clearAppBadge).toHaveBeenCalledTimes(1);
    // The declarative field works too (the same number, for Safari).
    await sw.push({
      title: 'x',
      web_push: 8030,
      notification: { title: 'x', navigate: ORIGIN },
      app_badge: 2,
    });
    expect(api.setAppBadge).toHaveBeenLastCalledWith(2);
  });

  it('leaves the icon alone when the message has no count', async () => {
    const api = badging();
    const sw = worker({ badging: api });
    await sw.push({ title: 'Booking confirmed', body: 'Tomorrow, 11:00' });
    await sw.push({ title: 'Booking confirmed', body: 'Tomorrow, 11:00', badge: null });
    await sw.push({ title: 'Booking confirmed', body: 'Tomorrow, 11:00', badge: -1 });
    expect(api.setAppBadge).not.toHaveBeenCalled();
    expect(api.clearAppBadge).not.toHaveBeenCalled();
  });

  it('still shows the notification where the Badging API is missing or refuses', async () => {
    const missing = worker();
    await missing.push({ title: 'New booking request', body: 'Ana', badge: 1 });
    expect(missing.showNotification).toHaveBeenCalledTimes(1);

    const refusing = worker({
      badging: {
        setAppBadge: vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))),
      },
    });
    await refusing.push({ title: 'New booking request', body: 'Ana', badge: 1 });
    expect(refusing.showNotification).toHaveBeenCalledTimes(1);
  });
});
