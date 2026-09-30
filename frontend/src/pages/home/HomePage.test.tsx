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
let past: unknown[] = [];
let summary = { visits: 0, firstVisitAt: null as string | null };
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
          location: { lat: 47.063205, lng: 28.844794 },
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
      return json({ appointments: url.searchParams.get('scope') === 'past' ? past : [] });
    case '/api/appointments/summary':
      return json(summary);
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
  past = [];
  summary = { visits: 0, firstVisitAt: null };
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

/** A past visit as the API lists it. */
const pastVisit = (id: string, start: string, service: string, status = 'completed', totalPrice = 370) => ({
  id,
  code: id.toUpperCase(),
  start,
  end: start,
  durationMin: 90,
  status,
  services: [{ serviceId: 's1', name: text(service), durationMin: 90, price: totalPrice, priceFrom: false }],
  totalPrice,
  priceFrom: false,
  staff: null,
  notes: '',
  nailShape: null,
});

describe('the visit history on Home', () => {
  it('shows the last three visits done, how many there have been and since when', async () => {
    past = [
      pastVisit('v5', '2026-09-20T11:00:00.000Z', 'Refill, size 1', 'cancelled'),
      pastVisit('v4', '2026-09-16T11:00:00.000Z', 'Gel polish'),
      pastVisit('v3', '2026-08-22T08:30:00.000Z', 'Extensions, size 1', 'completed', 400),
      pastVisit('v2', '2026-07-28T13:00:00.000Z', 'Refill, size 1'),
      pastVisit('v1', '2025-12-10T13:00:00.000Z', 'Gel polish'),
    ];
    summary = { visits: 7, firstVisitAt: '2025-03-04T10:00:00.000Z' };
    renderHome();

    const section = (await screen.findByRole('heading', { name: 'Your visits' })).closest('section')!;
    expect(within(section).getByText('7 visits · with us since March 2025')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /All visits/ })).toHaveAttribute('href', '/en/bookings?tab=past');
    // The cancelled visit isn't one; the fourth one done waits in My bookings.
    const rows = within(section).getAllByRole('listitem').map((row) => within(row).getByRole('link'));
    expect(rows.map((row) => row.getAttribute('href'))).toEqual(['/en/bookings/v4', '/en/bookings/v3', '/en/bookings/v2']);
    expect(rows[0]).toHaveTextContent(/Wednesday, 14:00/);
    expect(rows[0]).toHaveTextContent(/Gel polish/);
    expect(rows[1]).toHaveTextContent(/400\sMDL/);
  });

  it('counts a confirmed visit that is over, even if nobody marked it done', async () => {
    past = [pastVisit('v2', '2026-09-16T11:00:00.000Z', 'Gel polish', 'confirmed'), pastVisit('v1', '2026-09-01T11:00:00.000Z', 'French', 'no_show')];
    summary = { visits: 1, firstVisitAt: '2026-09-16T11:00:00.000Z' };
    renderHome();
    const section = (await screen.findByRole('heading', { name: 'Your visits' })).closest('section')!;
    expect(within(section).getByText('1 visit · with us since September 2026')).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
  });

  it('says where the visits will be before the first one', async () => {
    past = [pastVisit('v1', '2026-09-16T11:00:00.000Z', 'Gel polish', 'cancelled')];
    renderHome();
    const section = (await screen.findByRole('heading', { name: 'Your visits' })).closest('section')!;
    expect(within(section).getByText(/Your visits will show here after the first/)).toBeInTheDocument();
    expect(within(section).queryByRole('link', { name: /All visits/ })).not.toBeInTheDocument();
  });
});

describe('getting to the studio from Home', () => {
  it('"Getting here" opens the choice of maps apps, each with the route to the pin', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Getting here' }));
    const sheet = await screen.findByRole('dialog', { name: 'Directions to the studio' });
    // A computer (the test browser): the maps, no taxi.
    const apps = within(sheet).getAllByRole('link');
    expect(apps.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Google MapsA route from where you are', 'https://www.google.com/maps/dir/?api=1&destination=47.063205,28.844794'],
      ['Apple MapsA route from where you are', 'https://maps.apple.com/directions?destination=47.063205,28.844794'],
      ['WazeA route from where you are', 'https://waze.com/ul?ll=47.063205,28.844794&navigate=yes'],
    ]);
    for (const app of apps) expect(app).toHaveAttribute('target', '_blank');
  });

  it('keeps directions out of "Write to us"', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(await screen.findByRole('button', { name: 'Write to us' }));
    const sheet = await screen.findByRole('dialog', { name: 'Contact the studio' });
    expect(within(sheet).queryByRole('link', { name: /Directions/ })).not.toBeInTheDocument();
  });
});
