import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PushModule from '@/lib/push';
import { AuthProvider } from '@/app/auth';
import { enablePush, readPushState } from '@/lib/push';
import { DAY_MS, readSchedule } from '@/lib/pushPrompt';
import { useSheetTurn } from '@/lib/sheetQueue';
import common from '@/locales/en/common.json';
import push from '@/locales/en/push.json';
import type { User } from '@/types/api';
import { PushPrompt } from './PushPrompt';

/*
 * The "Turn on notifications?" sheet: when it appears for clients and staff, and what its
 * button does (permission in the tap, this device, and the service messages in ONE request).
 */

vi.mock('@/lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof PushModule>()),
  readPushState: vi.fn(),
  enablePush: vi.fn(),
  resyncPush: vi.fn(async () => undefined),
}));

const person = (role: User['role'], id: string): User => ({
  id,
  email: `${id}@example.com`,
  name: 'Ana',
  surname: 'Rusu',
  phone: null,
  role,
  locale: 'en',
  hasPassword: true,
  hasGoogle: false,
  bookingBlocked: false,
  isDemo: false,
  onboarded: true,
  createdAt: '2026-01-01T09:00:00.000Z',
});

const channels = { email: true, push: true };
const settings = {
  prefs: {
    reminders: { ...channels, enabled: true, leadMinutes: [60] },
    bookingUpdates: channels,
    staffBookings: channels,
    loyalty: { email: false, push: true },
    marketing: { email: false, push: false, consentAt: null },
  },
  email: { address: 'ana@example.com', available: true },
  push: { available: true, publicKey: 'BPUBLICKEY', devices: 0 },
};
const patches: unknown[] = [];

/** A sheet of another feature that opens with the staff app: it must wait its turn. */
function PendingRequestsSheet() {
  return (
    <p data-testid="pending">{useSheetTurn('pending-requests', 10, true) ? 'open' : 'waiting'}</p>
  );
}

function renderApp(user: User, path: string, extra: React.ReactNode = null) {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['push', 'common'],
    defaultNS: 'common',
    resources: { en: { push, common } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['me'], user);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <PushPrompt audience={user.role === 'client' ? 'client' : 'staff'} />
            {extra}
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/**
 * Waits for a condition. The sheet's timer and the clock are fake, so RTL's waitFor (which polls
 * with setInterval) can't be used; vi.waitFor moves the fake clock 10 ms per look.
 */
const until = (check: () => void) => vi.waitFor(check, { timeout: 3_000, interval: 10 });

/** Lets the sheet's once-a-second check run for `ms` (the app's age and the clock move on). */
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
/** The notifications sheet (a <dialog> named by its title). */
const sheet = () => document.querySelector<HTMLDialogElement>('dialog[aria-labelledby]');
const isOpen = () => sheet()?.hasAttribute('open') ?? false;

beforeEach(() => {
  patches.length = 0;
  window.localStorage.clear();
  // Only the clock and the sheet's own timer are fake: fetches and promises run as usual.
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'Date'],
    now: Date.UTC(2026, 8, 27, 9),
  });
  vi.mocked(readPushState).mockResolvedValue('off');
  vi.mocked(enablePush).mockResolvedValue('on');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (path === '/api/notifications' && (init?.method ?? 'GET') === 'GET') return json(settings);
      if (path === '/api/notifications/prefs' && init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        return json({ prefs: settings.prefs });
      }
      throw new Error(`Unmocked request: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
});
afterEach(() => {
  for (const other of document.querySelectorAll('dialog:not([aria-labelledby])')) other.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('clients', () => {
  it('are asked about 8 s after the app opens; the button turns everything on in one request', async () => {
    const user = userEvent.setup();
    renderApp(person('client', 'c1'), '/en/home');
    await until(() => expect(readPushState).toHaveBeenCalledWith('c1'));

    await wait(6_000);
    expect(isOpen()).toBe(false);
    await wait(3_000);
    await wait(1_000);
    await until(() => expect(isOpen()).toBe(true));
    const dialog = within(sheet()!);
    expect(dialog.getByRole('heading', { name: 'Turn on notifications?' })).toBeInTheDocument();
    expect(dialog.getByText('when the master confirms or moves your visit')).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Turn on notifications' }));
    // The permission prompt comes from this tap, with the key the page already has.
    expect(enablePush).toHaveBeenCalledWith('c1', { publicKey: 'BPUBLICKEY' });
    await until(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      reminders: { enabled: true, email: true, push: true },
      bookingUpdates: { email: true, push: true },
      loyalty: { email: true, push: true },
    });
    await until(() => expect(isOpen()).toBe(false));
    // Turned on: never asked again on this device.
    expect(readSchedule('c1').done).toBe(true);
    await wait(60_000);
    expect(isOpen()).toBe(false);
    expect(patches).toHaveLength(1);
  });

  it('wait while another sheet is open, and "Not now" asks again in 3 days', async () => {
    const user = userEvent.setup();
    const other = document.createElement('dialog');
    other.setAttribute('open', '');
    document.body.append(other);
    renderApp(person('client', 'c2'), '/en/bookings');
    await until(() => expect(readPushState).toHaveBeenCalled());

    await wait(20_000);
    expect(isOpen()).toBe(false);
    other.remove();
    await wait(2_000);
    await until(() => expect(isOpen()).toBe(true));

    const tappedAt = Date.now();
    await user.click(within(sheet()!).getByRole('button', { name: 'Not now' }));
    expect(readSchedule('c2')).toMatchObject({
      dismissals: 1,
      nextAt: tappedAt + 3 * DAY_MS,
      done: false,
    });
    await until(() => expect(isOpen()).toBe(false));
    expect(patches).toHaveLength(0);
    expect(enablePush).not.toHaveBeenCalled();
  });

  it('are never asked in the booking flow, over the first-run intro, or with notifications blocked', async () => {
    const { unmount } = renderApp(person('client', 'c3'), '/en/book');
    await until(() => expect(readPushState).toHaveBeenCalled());
    await wait(30_000);
    expect(isOpen()).toBe(false);
    unmount();

    renderApp({ ...person('client', 'c4'), onboarded: false }, '/en/home');
    await wait(30_000);
    expect(isOpen()).toBe(false);

    vi.mocked(readPushState).mockResolvedValue('denied');
    renderApp(person('client', 'c5'), '/en/home');
    await wait(30_000);
    expect(isOpen()).toBe(false);
  });
});

describe('staff', () => {
  it('are asked on every open until subscribed; other sheets wait; "Not now" lasts until the next open', async () => {
    const user = userEvent.setup();
    renderApp(person('admin', 's1'), '/en/admin', <PendingRequestsSheet />);
    // Deciding: the pending-requests sheet already waits behind it.
    expect(screen.getByTestId('pending')).toHaveTextContent('waiting');
    await until(() => expect(readPushState).toHaveBeenCalledWith('s1'));

    await wait(2_000);
    await wait(1_000);
    await until(() => expect(isOpen()).toBe(true));
    const dialog = within(sheet()!);
    expect(
      dialog.getByText(/New booking requests arrive here and need a quick answer/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('pending')).toHaveTextContent('waiting');

    await user.click(dialog.getByRole('button', { name: 'Not now' }));
    await until(() => expect(isOpen()).toBe(false));
    // Its turn is over: the other sheet opens now.
    await until(() => expect(screen.getByTestId('pending')).toHaveTextContent('open'));
    // No backoff kept for staff, and nothing asked again in the same open…
    expect(readSchedule('s1').dismissals).toBe(0);
    await wait(10 * 60_000);
    expect(isOpen()).toBe(false);
    // …but back after half an hour (a new open), it asks again.
    await wait(21 * 60_000);
    await wait(1_000);
    await until(() => expect(isOpen()).toBe(true));

    await user.click(within(sheet()!).getByRole('button', { name: 'Turn on notifications' }));
    await until(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      staffBookings: { email: true, push: true },
      bookingUpdates: { email: true, push: true },
    });
  });
});
