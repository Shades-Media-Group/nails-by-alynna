import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/app/auth';
import type * as Platform from '@/lib/platform';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import feedback from '@/locales/en/feedback.json';
import loyalty from '@/locales/en/loyalty.json';
import HomePage from '@/pages/home/HomePage';

/*
 * The "loyalty card in Wallet" block on Home, under the studio block: clients only, closed for
 * good with ×, and its sheet offers this device's Wallet or says honestly that it is coming.
 */

const device = vi.hoisted(() => ({ wallets: ['apple', 'google'] as Array<'apple' | 'google'>, standalone: false }));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  walletsHere: () => device.wallets,
  isStandalone: () => device.standalone,
}));

const text = (en: string) => ({ ro: en, ru: en, en });
const person = (role: string) => ({
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana',
  surname: 'Rusu',
  phone: '+37369123456',
  role,
  locale: 'en',
  hasPassword: true,
  hasGoogle: false,
  bookingBlocked: false,
  isDemo: false,
  onboarded: true,
  createdAt: '2026-01-01T09:00:00.000Z',
});

let wallet = { apple: false, google: false };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function respond(url: URL): Response {
  switch (url.pathname) {
    case '/api/config':
      return json({
        auth: { google: false, demo: [] },
        studio: { name: 'Nails by Alynna', timezone: 'Europe/Chisinau', currency: 'MDL', tagline: text(''), about: text(''), address: '', city: 'Chișinău', mapsUrl: '', location: { lat: 47.063205, lng: 28.844794 } },
        booking: { requireApproval: false, cancellationWindowHours: 12, leadTimeMin: 120, horizonDays: 60, maxActiveBookings: 3, policy: text(''), mastersCount: 1 },
        loyalty: { enabled: true, cycle: 8, rewards: [{ visit: 4, percent: 15 }] },
      });
    case '/api/appointments':
      return json({ appointments: [] });
    case '/api/staff':
      return json({ staff: [] });
    case '/api/catalog':
      return json({ categories: [], services: [] });
    case '/api/feedback/pending':
      return json({ visit: null });
    case '/api/loyalty':
      return json({
        card: { code: 'K7QM2XRP', url: 'https://example.com/c/K7QM2XRP' },
        loyalty: { enabled: true, cycle: 8, rewards: [{ visit: 4, percent: 15 }], visits: 3, stamps: 3, card: 1, nextReward: { visit: 4, percent: 15, inVisits: 1 }, history: [] },
      });
    case '/api/wallet':
      return json(wallet);
    case '/api/wallet/apple/link':
      return json({ url: '/api/wallet/apple/pass/token.pkpass' });
    case '/api/wallet/google':
      return json({ url: 'https://pay.google.com/gp/v/save/jwt' });
  }
  throw new Error(`Unmocked request: ${url.pathname}`);
}

function renderHome(role = 'client') {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common', 'booking', 'loyalty', 'feedback'],
    defaultNS: 'common',
    resources: { en: { common, booking, loyalty, feedback } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['me'], person(role));
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/en/home']}>
            <HomePage />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const TITLE = 'Your loyalty card in Wallet';
const studioBlock = () => screen.getByRole('button', { name: booking.home.shortcutContact }).closest('section')!;

beforeEach(() => {
  wallet = { apple: false, google: false };
  device.wallets = ['apple', 'google'];
  device.standalone = false;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => respond(new URL(String(input), 'http://localhost'))));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })));
});
afterEach(() => vi.unstubAllGlobals());

describe('the Wallet block on Home', () => {
  it('sits right under the studio block for a client, saying which Wallet this phone has', async () => {
    device.wallets = ['apple'];
    renderHome();
    const title = await screen.findByText(TITLE, { selector: 'p' });
    const block = title.closest('div.relative')!;
    expect(studioBlock().compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(studioBlock().nextElementSibling).toBe(block);
    expect(within(block as HTMLElement).getByRole('button', { name: /Add to Apple\sWallet/ })).toBeInTheDocument();
  });

  it('never shows in the staff app', async () => {
    renderHome('admin');
    expect(await screen.findByRole('button', { name: booking.home.shortcutContact })).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/api/loyalty'))).toBe(true));
    expect(screen.queryByText(TITLE, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('× closes it, and it stays closed', async () => {
    const user = userEvent.setup();
    const first = renderHome();
    const block = (await screen.findByText(TITLE, { selector: 'p' })).closest('div.relative') as HTMLElement;
    await user.click(within(block).getByRole('button', { name: common.actions.close }));
    expect(screen.queryByText(TITLE, { selector: 'p' })).not.toBeInTheDocument();

    first.unmount();
    renderHome();
    expect(await screen.findByRole('button', { name: booking.home.shortcutContact })).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/api/loyalty')).length).toBeGreaterThan(1));
    expect(screen.queryByText(TITLE, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('says "coming soon" instead of a button while no Wallet is set up', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Add to Wallet' }));
    const sheet = screen.getByRole('dialog', { name: TITLE });
    expect(await within(sheet).findByText('Adding to Wallet is coming soon.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /Add to (Apple|Google)\sWallet/ })).not.toBeInTheDocument();
    // The preview is the client's own card.
    const preview = within(sheet).getByRole('figure', { name: 'Your card as it will look in Wallet' });
    expect(within(preview).getByText('Ana Rusu')).toBeInTheDocument();
    expect(within(preview).getByText('3/8')).toBeInTheDocument();
    expect(within(preview).getByText('K7QM 2XRP')).toBeInTheDocument();
    expect(within(preview).getByText(/15%\soff your next visit/)).toBeInTheDocument();
  });

  it("offers this phone's Wallet once it is set up, and adding the card retires the block", async () => {
    wallet = { apple: true, google: false };
    device.wallets = ['apple'];
    device.standalone = true;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: /Add to Apple\sWallet/ }));
    const sheet = screen.getByRole('dialog', { name: TITLE });
    const add = await within(sheet).findByRole('button', { name: /Add to Apple\sWallet/ });
    expect(within(sheet).queryByRole('button', { name: /Add to Google\sWallet/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/coming soon/)).not.toBeInTheDocument();

    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    // The installed iPhone app opens the pass file in its own view.
    expect(open).toHaveBeenCalledWith('/api/wallet/apple/pass/token.pkpass', '_blank', 'noopener');
    expect(screen.queryByText(TITLE, { selector: 'p' })).not.toBeInTheDocument();
    open.mockRestore();
  });

  it('offers both Wallets on a computer, and only the one that is set up as a button', async () => {
    wallet = { apple: false, google: true };
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Add to Wallet' }));
    const sheet = screen.getByRole('dialog', { name: TITLE });
    expect(await within(sheet).findByRole('button', { name: /Add to Google\sWallet/ })).toBeInTheDocument();
    expect(within(sheet).getByText(/Adding to Apple\sWallet is coming soon\./)).toBeInTheDocument();
  });
});
