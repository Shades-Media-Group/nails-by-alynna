import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import { saveSeenVisits } from '@/lib/visitStatus';
import type { Appointment } from '@/types/api';
import { VisitConfirmedSheet } from './VisitConfirmedSheet';

/** Lets TanStack Query deliver an update (it notifies observers on a zero-delay timer). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

vi.mock('@/app/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'client', isDemo: false } }),
}));
vi.mock('@/hooks/useStudio', () => ({
  useStudio: () => ({ timeZone: 'Europe/Chisinau' }),
  useI18nText: () => (text: { en: string }) => text.en,
}));

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en',
  ns: ['booking', 'common'],
  defaultNS: 'booking',
  resources: { en: { booking, common } },
  initAsync: false,
});

const visit = (status: Appointment['status']) =>
  ({
    id: 'a1',
    status,
    start: '2026-09-28T09:00:00.000Z',
    staff: { id: 's1', name: 'Alina' },
    services: [
      {
        id: 'x',
        name: { ro: 'Gel', ru: 'Гель', en: 'Gel polish' },
        durationMin: 90,
        price: 300,
        priceFrom: false,
      },
    ],
  }) as unknown as Appointment;

function mount(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/en/home']}>
          <VisitConfirmedSheet />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchInterval: false } } });
const sheet = () =>
  screen.queryByRole('dialog', { name: "You're booked!" }) as HTMLDialogElement | null;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('<VisitConfirmedSheet>', () => {
  it('celebrates a request the studio confirms while the app is open, once', async () => {
    const client = newClient();
    client.setQueryData(['appointments', 'upcoming'], [visit('pending')]);
    mount(client);
    await settle();
    expect(sheet()).toBeNull();

    client.setQueryData(['appointments', 'upcoming'], [visit('confirmed')]);
    await settle();
    expect(sheet()).not.toBeNull();
    expect(screen.getByText(/Alina is expecting you/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View booking' })).toHaveAttribute(
      'href',
      '/en/bookings/a1',
    );

    // Done: it slides away, and the same visit coming in again is not news any more.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(sheet()?.open ?? false).toBe(false));
    client.setQueryData(['appointments', 'upcoming'], [{ ...visit('confirmed') }]);
    await settle();
    expect(sheet()?.open ?? false).toBe(false);
  });

  it('celebrates it on the next opening when it happened while the app was closed', async () => {
    saveSeenVisits('u1', [visit('pending')]);
    const client = newClient();
    client.setQueryData(['appointments', 'upcoming'], [visit('confirmed')]);
    mount(client);
    await settle();
    expect(sheet()).not.toBeNull();
  });

  it('stays quiet on a device that never saw the request', async () => {
    const client = newClient();
    client.setQueryData(['appointments', 'upcoming'], [visit('confirmed')]);
    mount(client);
    await settle();
    expect(sheet()).toBeNull();
  });
});
