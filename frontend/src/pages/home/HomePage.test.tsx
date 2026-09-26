import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/app/auth';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import feedback from '@/locales/en/feedback.json';
import loyalty from '@/locales/en/loyalty.json';
import HomePage from './HomePage';

const VISIT = '66f5a1b2c3d4e5f6a7b8c9d0';
const text = (en: string) => ({ ro: en, ru: en, en });
const client = {
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana',
  surname: 'Rusu',
  phone: '+37369123456',
  role: 'client',
  locale: 'en',
  hasPassword: true,
  hasGoogle: false,
  bookingBlocked: false,
  isDemo: false,
  onboarded: true,
  createdAt: '2026-01-01T09:00:00.000Z',
};

let pending: unknown = null;
const posts: Array<{ path: string; body: unknown }> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function respond(url: URL, init?: RequestInit): Response {
  if (init?.method === 'POST') {
    posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
    return json({ ok: true });
  }
  switch (url.pathname) {
    case '/api/config':
      return json({
        auth: { google: false, demo: [] },
        studio: {
          name: 'Nails by Alynna',
          timezone: 'Europe/Chisinau',
          currency: 'MDL',
          tagline: text(''),
          about: text(''),
          address: '',
          city: 'Chișinău',
          mapsUrl: '',
        },
        booking: {
          requireApproval: false,
          cancellationWindowHours: 12,
          leadTimeMin: 120,
          horizonDays: 60,
          maxActiveBookings: 3,
          policy: text(''),
          mastersCount: 1,
        },
        loyalty: { enabled: false, cycle: 8, rewards: [] },
      });
    case '/api/appointments':
      return json({ appointments: [] });
    case '/api/staff':
      return json({ staff: [] });
    case '/api/catalog':
      return json({ categories: [], services: [] });
    case '/api/loyalty':
      return json({
        card: { code: 'K7QM2XRP', url: 'https://example.com/c/K7QM2XRP' },
        loyalty: { enabled: false },
      });
    case '/api/feedback/pending':
      return json({ visit: pending });
    default:
      throw new Error(`Unmocked request: ${url.pathname}`);
  }
}

function renderHome() {
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
  queryClient.setQueryData(['me'], client);
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

beforeEach(() => {
  pending = null;
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(new URL(String(input), 'http://localhost'), init),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('the feedback card on Home', () => {
  it('asks about the last visit: each star opens the feedback page with that rating; "Not now" closes it', async () => {
    pending = {
      id: VISIT,
      start: '2026-09-25T07:00:00.000Z',
      end: '2026-09-25T08:30:00.000Z',
      services: [text('Gel polish'), text('French')],
      master: 'Alina',
    };
    const user = userEvent.setup();
    renderHome();

    const card = (
      await screen.findByRole('heading', { name: 'How was your visit with Alina?' })
    ).closest('section')!;
    expect(within(card).getByText(/Gel polish, French/)).toBeInTheDocument();
    const stars = within(card).getAllByRole('link');
    expect(
      stars.map((star) => [star.getAttribute('aria-label'), star.getAttribute('href')]),
    ).toEqual(
      [1, 2, 3, 4, 5].map((rating) => [
        rating === 1 ? '1 star' : `${rating} stars`,
        `/en/feedback?visit=${VISIT}&rating=${rating}`,
      ]),
    );

    await user.click(within(card).getByRole('button', { name: 'Not now' }));
    expect(
      screen.queryByRole('heading', { name: 'How was your visit with Alina?' }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(posts).toEqual([{ path: '/api/feedback/dismiss', body: { appointmentId: VISIT } }]),
    );
  });

  it('stays away when there is nothing to ask about', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { name: /Hi, Ana/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([input]) => String(input).includes('/api/feedback/pending')),
      ).toBe(true),
    );
    expect(screen.queryByRole('heading', { name: /How was your visit/ })).not.toBeInTheDocument();
  });
});
