import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/app/auth';
import { rebookQuery } from '@/lib/appointment';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import loyalty from '@/locales/en/loyalty.json';
import promo from '@/locales/en/promo.json';
import type { Appointment, NailShape } from '@/types/api';
import BookingPage from './BookingPage';

/*
 * The booking flow against a mocked API: the nail shape is asked on the services step, before
 * Continue lets the client on, and it travels with the booking and with "Book again".
 */

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
  createdAt: '2026-01-01T09:00:00.000Z',
};
const service = {
  id: 's1',
  categoryId: 'k1',
  slug: 'gel-polish',
  name: text('Gel polish'),
  description: text('Gel polish on natural nails.'),
  durationMin: 90,
  price: 300,
  priceFrom: false,
  art: 'gel',
  isPopular: true,
};
const slot = { start: '2030-03-05T08:00:00.000Z', time: '10:00', staffIds: ['m1'] };

function appointment(nailShape: NailShape | null): Appointment {
  return {
    id: 'a1',
    code: 'A7K2Q9',
    status: 'confirmed',
    start: slot.start,
    end: '2030-03-05T09:30:00.000Z',
    durationMin: 90,
    totalPrice: 300,
    priceFrom: false,
    services: [
      { id: 's1', name: text('Gel polish'), durationMin: 90, price: 300, priceFrom: false },
    ],
    nailShape,
    staff: { id: 'm1', name: 'Alina', title: text('Nail artist'), color: 'blush' },
    notes: '',
    canChange: true,
    changeDeadline: '2030-03-04T20:00:00.000Z',
    cancelledAt: null,
    cancelledBy: null,
    loyalty: null,
    createdAt: '2030-03-01T10:00:00.000Z',
  };
}

const posts: Array<{ path: string; body: Record<string, unknown> }> = [];

function respond(url: URL, init?: RequestInit): Response {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (init?.method === 'POST' && url.pathname === '/api/appointments') {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    posts.push({ path: url.pathname, body });
    return json(
      { appointment: appointment((body.nailShape as NailShape | undefined) ?? null) },
      201,
    );
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
    case '/api/catalog':
      return json({
        categories: [
          {
            id: 'k1',
            slug: 'other',
            name: text('Other services'),
            description: null,
            singleChoice: false,
            color: 'peach',
          },
        ],
        services: [service],
      });
    case '/api/staff':
      return json({
        staff: [
          {
            id: 'm1',
            name: 'Alina',
            title: text('Nail artist'),
            color: 'blush',
            serviceIds: null,
            weekly: [],
          },
        ],
      });
    case '/api/availability/days':
      return json({
        durationMin: 90,
        window: { first: '2030-03-05', last: '2030-04-18' },
        staffCount: 1,
        days: [{ date: '2030-03-05', slots: 1 }],
      });
    case '/api/availability/slots':
      return json({ date: '2030-03-05', durationMin: 90, slots: [slot] });
    case '/api/loyalty':
      return json({
        card: { code: 'K7QM2XRP', url: 'https://example.com/c/K7QM2XRP' },
        loyalty: {
          enabled: false,
          cycle: 8,
          rewards: [],
          visits: 0,
          stamps: 0,
          card: 1,
          nextReward: null,
          history: [],
        },
      });
    case '/api/appointments':
      return json({ appointments: [] });
  }
  throw new Error(`Unmocked request: ${url.pathname}`);
}

/** Where the flow is: the query string of the booking page's URL, rendered next to the page. */
function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}
const currentSearch = () => screen.getByTestId('location').textContent ?? '';

function renderBooking(url: string, me: typeof client = client) {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['booking', 'common', 'loyalty', 'promo'],
    defaultNS: 'common',
    resources: { en: { booking, common, loyalty, promo } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['me'], me);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[url]}>
            <BookingPage />
            <LocationProbe />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(new URL(String(input), 'http://localhost'), init),
    ),
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  // jsdom lays nothing out, so it has no scrollIntoView; the page calls it to show the shapes.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('nail shape in the booking flow', () => {
  it('blocks Continue until a shape is picked, then books with it', async () => {
    const user = userEvent.setup();
    renderBooking('/en/book?services=s1');

    // A link that skips the shape (Popular on Home) opens on the services step, where it is asked.
    expect(
      await screen.findByRole('heading', { name: 'What would you like?' }),
    ).toBeInTheDocument();
    const group = await screen.findByRole('radiogroup', { name: 'Nail shape' });
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
    expect(within(group).queryByRole('radio', { checked: true })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Please pick a nail shape to continue.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What would you like?' })).toBeInTheDocument();
    expect(currentSearch()).not.toContain('step=time');
    // Focus goes to the shapes, so a screen reader lands where the answer is missing.
    expect(within(group).getByRole('radio', { name: 'Square' })).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await user.click(within(group).getByRole('radio', { name: 'Almond' }));
    expect(within(group).getByRole('radio', { name: 'Almond' })).toBeChecked();
    expect(screen.queryByText('Please pick a nail shape to continue.')).not.toBeInTheDocument();
    expect(new URLSearchParams(currentSearch()).get('shape')).toBe('almond');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'When suits you?' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // The summary names the shape above the services.
    expect(await screen.findByRole('heading', { name: 'Check and confirm' })).toBeInTheDocument();
    expect(screen.getByText('Almond')).toBeInTheDocument();
    expect(screen.getByText('Nail shape')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({
      serviceIds: ['s1'],
      start: slot.start,
      nailShape: 'almond',
    });
    expect(await screen.findByRole('heading', { name: "You're booked!" })).toBeInTheDocument();
    expect(screen.getByText('Nail shape: Almond')).toBeInTheDocument();
  });

  it('"Book again" brings the shape back and goes straight to the time', async () => {
    const user = userEvent.setup();
    const query = rebookQuery(appointment('stiletto'));
    expect(new URLSearchParams(query).get('shape')).toBe('stiletto');
    renderBooking(`/en/book${query}`);

    expect(await screen.findByRole('heading', { name: 'When suits you?' })).toBeInTheDocument();
    // Back walks to the services step with the shape still chosen.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('radio', { name: 'Stiletto' })).toBeChecked();
  });

  it('"Book again" of a visit booked before shapes were asked stops at the shapes first', async () => {
    const query = rebookQuery(appointment(null));
    expect(new URLSearchParams(query).has('shape')).toBe(false);
    renderBooking(`/en/book${query}`);

    expect(
      await screen.findByRole('heading', { name: 'What would you like?' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('radiogroup', { name: 'Nail shape' })).toBeInTheDocument();
    // The services of that visit are already chosen.
    expect(await screen.findByRole('button', { name: 'Remove Gel polish' })).toBeInTheDocument();
  });
});

describe('the demo account', () => {
  it('sees what comes after booking, and nothing is sent', async () => {
    const user = userEvent.setup();
    renderBooking('/en/book?services=s1&shape=almond', { ...client, isDemo: true });

    await user.click(await screen.findByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByRole('heading', { name: "You're booked!" })).toBeInTheDocument();
    expect(
      screen.getByText('Demo account: nothing was sent. This is what you see after booking.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Nail shape: Almond')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    // There is no booking to open or to put in a calendar.
    expect(screen.queryByRole('link', { name: 'View booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toBeInTheDocument();
  });
});
