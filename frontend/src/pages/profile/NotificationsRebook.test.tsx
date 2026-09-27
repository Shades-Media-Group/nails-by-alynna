import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import account from '@/locales/en/account.json';
import common from '@/locales/en/common.json';
import accountRo from '@/locales/ro/account.json';
import accountRu from '@/locales/ru/account.json';
import type { User } from '@/types/api';
import NotificationsPage from './NotificationsPage';

/*
 * Profile → Notifications: the "Reminders to come back" group (email / app per client). The
 * rest of the page (this device's switch, the App toggles) is covered with the push work.
 */

const auth = vi.hoisted(() => ({ role: 'client' as User['role'] }));
vi.mock('@/app/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      email: 'ana@example.com',
      name: 'Ana',
      surname: 'Rusu',
      phone: null,
      role: auth.role,
      locale: 'en',
      hasPassword: true,
      hasGoogle: false,
      bookingBlocked: false,
      isDemo: false,
      onboarded: true,
      createdAt: '2026-01-01T09:00:00.000Z',
    },
    status: 'authenticated',
    isStaff: auth.role !== 'client',
  }),
}));

const channel = { email: true, push: true };
const prefs = {
  reminders: { enabled: true, leadMinutes: [60], ...channel },
  bookingUpdates: channel,
  staffBookings: channel,
  loyalty: channel,
  rebook: channel,
  marketing: { email: false, push: false, consentAt: null },
};
let studioSends = true;
const patches: unknown[] = [];

beforeEach(() => {
  auth.role = 'client';
  studioSends = true;
  patches.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      let body: unknown;
      if (init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as { rebook?: Record<string, boolean> };
        patches.push(patch);
        body = { prefs: { ...prefs, rebook: { ...prefs.rebook, ...patch.rebook } } };
      } else if (path === '/api/notifications') {
        body = { prefs, email: { address: 'ana@example.com', available: true }, push: { available: false, publicKey: null, devices: 0 } };
      } else if (path === '/api/config') {
        body = {
          auth: { google: false, demo: [] },
          studio: { name: 'Nails by Alynna', timezone: 'Europe/Chisinau', currency: 'MDL' },
          booking: { requireApproval: true, cancellationWindowHours: 12, leadTimeMin: 120, horizonDays: 60, maxActiveBookings: 3, mastersCount: 1 },
          loyalty: { enabled: true, cycle: 8, rewards: [] },
          rebook: { enabled: studioSends },
        };
      }
      return new Response(JSON.stringify(body ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderPage(lng = 'en') {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    ns: ['account', 'common'],
    defaultNS: 'common',
    resources: { en: { account, common }, ro: { account: accountRo, common }, ru: { account: accountRu, common } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/${lng}/profile/notifications`]}>
          <NotificationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('Profile → Notifications: reminders to come back', () => {
  it('shows the group with its explanation, and switches its email on and off', async () => {
    const user = userEvent.setup();
    renderPage();
    const group = within(await screen.findByRole('region', { name: 'Reminders to come back' }));
    expect(group.getByText("A note a few weeks after a visit, if you haven't booked the next one yet.")).toBeInTheDocument();
    const email = group.getByRole('button', { name: 'Email' });
    expect(email).toHaveAttribute('aria-pressed', 'true');

    await user.click(email);
    await waitFor(() => expect(patches).toEqual([{ rebook: { email: false } }]));
    await waitFor(() => expect(group.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'false'));
  });

  it('is left out while the studio does not send them, and for staff', async () => {
    studioSends = false;
    const { unmount } = renderPage();
    expect(await screen.findByRole('region', { name: 'Booking updates' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Reminders to come back' })).not.toBeInTheDocument();
    unmount();

    studioSends = true;
    auth.role = 'admin';
    renderPage();
    expect(await screen.findByRole('region', { name: "Clients' bookings" })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Reminders to come back' })).not.toBeInTheDocument();
  });

  it('reads in Romanian and Russian', async () => {
    const { unmount } = renderPage('ro');
    expect(await screen.findByRole('region', { name: 'Amintiri pentru următoarea vizită' })).toBeInTheDocument();
    unmount();
    renderPage('ru');
    expect(await screen.findByRole('region', { name: 'Напоминания о следующем визите' })).toBeInTheDocument();
  });
});
