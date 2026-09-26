import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PushModule from '@/lib/push';
import { AuthProvider } from '@/app/auth';
import { disablePush, enablePush, isAppleDevice, readPushState, type PushState } from '@/lib/push';
import { readSchedule } from '@/lib/pushPrompt';
import account from '@/locales/en/account.json';
import common from '@/locales/en/common.json';
import push from '@/locales/en/push.json';
import type { User } from '@/types/api';
import NotificationsPage from './NotificationsPage';

/*
 * Profile → Notifications: "App" shows what is saved (on by default) on any device, and asks for
 * this device's notifications when it is switched on; a short line says when this device isn't
 * getting them yet and what to do; "Send a test notification" reports each device.
 */

vi.mock('@/lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof PushModule>()),
  readPushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(async () => undefined),
  resyncPush: vi.fn(async () => undefined),
  isAppleDevice: vi.fn(() => false),
}));

const client: User = {
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana',
  surname: 'Rusu',
  phone: null,
  role: 'client',
  locale: 'en',
  hasPassword: true,
  hasGoogle: false,
  bookingBlocked: false,
  isDemo: false,
  onboarded: true,
  createdAt: '2026-01-01T09:00:00.000Z',
};

const settings = () => ({
  prefs: {
    reminders: { enabled: true, leadMinutes: [60], email: true, push: true },
    bookingUpdates: { email: true, push: true },
    staffBookings: { email: true, push: true },
    loyalty: { email: true, push: true },
    marketing: { email: false, push: false, consentAt: null },
  },
  email: { address: 'ana@example.com', available: true },
  push: { available: true, publicKey: 'BPUBLICKEY', devices: 0 },
});
const requests: Array<{ method: string; path: string; body: unknown }> = [];

function renderPage(device: PushState) {
  vi.mocked(readPushState).mockResolvedValue(device);
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['account', 'common', 'push'],
    defaultNS: 'common',
    resources: { en: { account, common, push } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['me'], client);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/en/profile/notifications']}>
            <NotificationsPage />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const group = (name: string) => within(screen.getByRole('region', { name }));
const appChip = (name: string) => group(name).getByRole('button', { name: 'App' });

beforeEach(() => {
  requests.length = 0;
  window.localStorage.clear();
  vi.mocked(enablePush).mockResolvedValue('on');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, path, body });
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (path === '/api/notifications') return json(settings());
      if (path === '/api/config')
        return json({
          studio: { timezone: 'Europe/Chisinau', currency: 'MDL' },
          booking: { requireApproval: true },
          loyalty: { enabled: true, rewards: [] },
        });
      if (path === '/api/notifications/prefs') {
        const prefs = settings().prefs;
        return json({ prefs: { ...prefs, ...body } });
      }
      if (path === '/api/notifications/push/test')
        return json({
          delaySec: body.delaySec,
          sent: 2,
          devices: 3,
          failed: 0,
          removed: 1,
          deliveries: [
            { service: 'apple', device: 'iphone', status: 201, outcome: 'sent' },
            { service: 'google', device: 'android', status: 201, outcome: 'sent' },
            { service: 'apple', device: 'mac', status: 410, outcome: 'gone' },
          ],
        });
      throw new Error(`Unmocked request: ${method} ${path}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const patches = () =>
  requests.filter((r) => r.method === 'PATCH' && r.path === '/api/notifications/prefs');

describe('"App" on a device without notifications', () => {
  it('shows the saved choice (on by default), not a greyed-out off', async () => {
    renderPage('off');
    expect(await screen.findByRole('region', { name: 'Booking updates' })).toBeInTheDocument();
    for (const name of ['Visit reminders', 'Booking updates', 'Loyalty rewards']) {
      expect(appChip(name)).toHaveAttribute('aria-pressed', 'true');
      expect(appChip(name)).toBeEnabled();
      // The state is honest: this device doesn't get them yet.
      expect(
        group(name).getByText("This device isn't getting app notifications yet."),
      ).toBeInTheDocument();
    }
    // News and offers stay off until chosen.
    expect(appChip('News and offers')).toHaveAttribute('aria-pressed', 'false');
    expect(
      group('News and offers').queryByText(/isn't getting app notifications/),
    ).not.toBeInTheDocument();
  });

  it('switching it on saves it and asks for this device in the same tap; switching off only saves', async () => {
    const user = userEvent.setup();
    renderPage('off');
    await screen.findByRole('region', { name: 'News and offers' });

    await user.click(appChip('News and offers'));
    expect(enablePush).toHaveBeenCalledTimes(1);
    expect(enablePush).toHaveBeenCalledWith('u1', { publicKey: 'BPUBLICKEY' });
    await waitFor(() => expect(patches()[0]?.body).toEqual({ marketing: { push: true } }));

    await user.click(appChip('Booking updates'));
    await waitFor(() => expect(patches()[1]?.body).toEqual({ bookingUpdates: { push: false } }));
    expect(enablePush).toHaveBeenCalledTimes(1);
  });

  it('"Turn on" in the line (or the card on top) asks for this device without changing the choices', async () => {
    const user = userEvent.setup();
    renderPage('off');
    const card = await screen.findByRole('region', {
      name: 'Get a notification when the master confirms',
    });
    await user.click(within(card).getByRole('button', { name: 'Turn on notifications' }));
    expect(enablePush).toHaveBeenCalledWith('u1', { publicKey: 'BPUBLICKEY' });
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Get a notification when the master confirms' }),
      ).not.toBeInTheDocument(),
    );
    expect(patches()).toHaveLength(0);
  });
});

describe('the line under "Send by"', () => {
  it('on an iPhone in Safari: the app needs the Home Screen, with a link to how', async () => {
    renderPage('needs-install');
    await screen.findByRole('region', { name: 'Booking updates' });
    const line = group('Booking updates').getByText('Only in the app added to the Home Screen.', {
      exact: false,
    });
    expect(within(line).getByRole('link', { name: 'How to add it' })).toHaveAttribute(
      'href',
      '/en/app',
    );
  });

  it('blocked: says so under each kind; the card on top has the steps, with the app as it is named on the Home Screen', async () => {
    vi.mocked(isAppleDevice).mockReturnValue(true);
    renderPage('denied');
    await screen.findByRole('region', { name: 'Booking updates' });
    expect(
      group('Booking updates').getByText("Blocked in this device's settings."),
    ).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Notifications are blocked' });
    expect(card).toHaveTextContent(
      'Open Settings → Notifications → Nails by Alynna and turn on Allow Notifications.',
    );
  });

  it('is gone once this device gets them', async () => {
    renderPage('on');
    await screen.findByRole('region', { name: 'Booking updates' });
    expect(screen.queryByText(/isn't getting app notifications/)).not.toBeInTheDocument();
    expect(appChip('Booking updates')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('this device, when notifications are on', () => {
  it('"Send a test notification" goes out after 5 s and says how many devices got it', async () => {
    const user = userEvent.setup();
    renderPage('on');
    await user.click(await screen.findByRole('button', { name: 'Send a test notification' }));
    expect(await screen.findByText('Sent to 2 devices.')).toBeInTheDocument();
    const sent = requests.find((r) => r.path === '/api/notifications/push/test');
    expect(sent).toMatchObject({ method: 'POST', body: { delaySec: 5 } });
    expect(screen.getByText('sent via Apple', { exact: false })).toHaveTextContent(
      'iPhone · sent via Apple',
    );
    expect(screen.getByText('sent via Google', { exact: false })).toHaveTextContent(
      'Android · sent via Google',
    );
    expect(screen.getByText('no longer subscribed', { exact: false })).toHaveTextContent(
      'Mac or iPad · no longer subscribed, removed',
    );
  });

  it('switching it off here stops the app from asking again on this device', async () => {
    const user = userEvent.setup();
    renderPage('on');
    await user.click(await screen.findByRole('switch', { name: 'Notifications on this device' }));
    await waitFor(() => expect(disablePush).toHaveBeenCalled());
    expect(readSchedule('u1').done).toBe(true);
  });
});
