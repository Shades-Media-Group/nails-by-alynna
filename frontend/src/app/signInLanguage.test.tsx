import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/pages/auth/LoginPage';
import LandingPage from '@/pages/landing/LandingPage';
import { createTestI18n } from '@/test/render';
import type { User } from '@/types/api';
import { AuthProvider } from './auth';
import { GuestOnly } from './guards';

/*
 * After signing in, the app opens in the language saved on the account (Romanian unless the
 * person chose another), not in the language the sign-in screen happened to be in.
 */

const account = (over: Partial<User> = {}): User => ({
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana',
  surname: 'Rusu',
  phone: null,
  role: 'client',
  locale: 'ro',
  hasPassword: true,
  hasGoogle: false,
  bookingBlocked: false,
  isDemo: false,
  onboarded: true,
  createdAt: '2026-01-01T09:00:00.000Z',
  ...over,
});

const text = (en: string) => ({ ro: en, ru: en, en });
const config = {
  auth: { google: false, demo: [] },
  studio: {
    name: 'Nails by Alynna',
    tagline: text(''),
    about: text(''),
    address: '',
    city: 'Chișinău',
    mapsUrl: '',
    location: { lat: 47.063205, lng: 28.844794 },
    phone: '',
    whatsapp: '',
    viber: '',
    telegram: '',
    instagram: '',
    email: '',
    legalName: '',
    legalId: '',
    timezone: 'Europe/Chisinau',
    currency: 'MDL',
  },
  booking: {
    requireApproval: true,
    cancellationWindowHours: 12,
    leadTimeMin: 120,
    horizonDays: 60,
    maxActiveBookings: 3,
    policy: text(''),
    mastersCount: 1,
  },
  loyalty: { enabled: false, cycle: 8, rewards: [] },
};

/** The page the app went to. */
function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderAt(url: string, signedIn: User | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['me'], signedIn);
  render(
    <I18nextProvider i18n={createTestI18n()}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route path="/en">
                <Route index element={<LandingPage />} />
                <Route element={<GuestOnly />}>
                  <Route path="login" element={<p>Sign-in choices</p>} />
                  <Route path="login/email" element={<LoginPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

let signsInAs: User = account();

beforeEach(() => {
  signsInAs = account();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (path === '/api/config') return json(config);
      if (path === '/api/auth/login' && init?.method === 'POST') return json({ user: signsInAs });
      throw new Error(`Unmocked request: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function signInWithEmail(url = '/en/login/email') {
  const user = userEvent.setup();
  renderAt(url);
  await user.type(screen.getByLabelText('Email'), 'ana@example.com');
  await user.type(screen.getByLabelText('Password'), 'Velvet-Nails-2026!');
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('the language after signing in', () => {
  it.each([
    ['a Romanian client', '/home', account()],
    ['the owner, Romanian', '/admin', account({ role: 'administrator' })],
    ['a master who chose Russian', '/ru/admin', account({ role: 'admin', locale: 'ru' })],
    ['a client who chose English', '/en/home', account({ locale: 'en' })],
  ])('signing in on the English screen: %s lands on %s', async (_who, destination, saved) => {
    signsInAs = saved;
    await signInWithEmail();
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`^${destination}$`)),
    );
  });

  it('keeps the page sign-in was asked for, in the account language', async () => {
    await signInWithEmail(`/en/login/email?next=${encodeURIComponent('/en/bookings/7')}`);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/bookings\/7$/));
  });

  it('sends someone already signed in from the English sign-in screen to their Romanian home', () => {
    renderAt('/en/login', account());
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/home$/);
  });

  it('opens the installed app (the start page) in the account language', () => {
    renderAt('/en', account({ role: 'admin' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin$/);
  });
});
