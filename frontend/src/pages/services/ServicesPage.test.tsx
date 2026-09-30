import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/app/auth';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import ServicesPage from './ServicesPage';

/*
 * The price list: picked services go on to booking only with a nail shape, asked in a sheet
 * when Continue is pressed.
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
  onboarded: true,
  createdAt: '2026-01-01T09:00:00.000Z',
};

function respond(url: URL): Response {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
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
          requireApproval: true,
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
        services: [
          {
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
          },
        ],
      });
  }
  throw new Error(`Unmocked request: ${url.pathname}`);
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderServices() {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['booking', 'common'],
    defaultNS: 'common',
    resources: { en: { booking, common } },
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
          <MemoryRouter initialEntries={['/en/services']}>
            <ServicesPage />
            <LocationProbe />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  // The category chips follow the scroll; jsdom lays nothing out.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => respond(new URL(String(input), 'http://localhost'))),
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('services → booking', () => {
  it('asks for the nail shape at the top and goes on only with one', async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    renderServices();

    const shapes = await screen.findByRole('radiogroup', { name: 'Nail shape' });
    expect(within(shapes).getAllByRole('radio')).toHaveLength(4);
    // Photos of the nails she wants can be added here too, as on the booking.
    expect(screen.getByRole('heading', { name: 'Photos of the nails you like' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Add Gel polish' }));

    // Without a shape: a warning, focus on the shapes, and no booking yet.
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Please pick a nail shape to continue.')).toBeInTheDocument();
    expect(within(shapes).getByRole('radio', { name: 'Square' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/en/services');

    await user.click(within(shapes).getByRole('radio', { name: 'Stiletto' }));
    expect(screen.queryByText('Please pick a nail shape to continue.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/en/book?services=s1&shape=stiletto');
  });
});
