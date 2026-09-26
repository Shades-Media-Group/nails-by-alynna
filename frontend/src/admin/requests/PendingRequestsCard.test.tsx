import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UiModule from '@/components/ui';
import admin from '@/locales/en/admin.json';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import type { StaffAppointment } from '@/types/api';
import { PendingRequestsCard } from './PendingRequestsCard';

/*
 * The top of "Today" while requests wait: how many, the oldest ones with Confirm / Decline, and
 * the whole list in place behind "See all".
 */

const m = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  toast: m.toast,
}));

const text = (en: string) => ({ ro: en, ru: en, en });
const request = (i: number) =>
  ({
    id: `a${i}`,
    code: `A${i}`,
    status: 'pending',
    start: '2030-03-05T12:00:00.000Z',
    end: '2030-03-05T13:30:00.000Z',
    durationMin: 90,
    totalPrice: 450,
    priceFrom: false,
    services: [
      { id: 's1', name: text('Gel polish'), durationMin: 90, price: 450, priceFrom: false },
    ],
    nailShape: null,
    staff: { id: 'm1', name: 'Alina', title: text('Nail master'), color: 'blush' },
    notes: '',
    createdAt: '2030-03-01T09:00:00.000Z',
    client: {
      id: `c${i}`,
      name: `Client${i}`,
      surname: 'Rusu',
      phone: null,
      email: `c${i}@example.com`,
    },
    staffNotes: '',
    source: 'client',
    cancelReason: '',
    clientStats: { visits: 0, noShows: 0 },
  }) as unknown as StaffAppointment;

let pending: StaffAppointment[] = [];
const patches: Array<{ path: string; body: unknown }> = [];

function renderCard() {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['admin', 'common', 'booking'],
    defaultNS: 'common',
    resources: { en: { admin, common, booking } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/en/admin']}>
          <Routes>
            <Route path="/en/admin" element={<PendingRequestsCard withMaster={false} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  patches.length = 0;
  m.toast.success.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (path === '/api/admin/appointments/pending')
        return json({ appointments: pending, total: pending.length, scope: 'all' });
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { status: string };
        patches.push({ path, body });
        const found = pending.find((a) => path.endsWith(`/${a.id}`))!;
        pending = pending.filter((a) => a !== found);
        return json({ appointment: { ...found, status: body.status } });
      }
      if (path === '/api/config')
        return json({ studio: { timezone: 'Europe/Chisinau', currency: 'MDL' } });
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
afterEach(() => vi.unstubAllGlobals());

describe('<PendingRequestsCard>', () => {
  it('counts the requests, shows the oldest three with their answers, and all of them behind "See all"', async () => {
    const user = userEvent.setup();
    pending = [1, 2, 3, 4, 5].map(request);
    renderCard();

    const card = await screen.findByRole(
      'region',
      { name: /^Requests to confirm\s*5$/ },
      { timeout: 3000 },
    );
    expect(within(card).getAllByRole('listitem')).toHaveLength(3);
    expect(within(card).getAllByRole('button', { name: 'Confirm' })).toHaveLength(3);
    expect(within(card).getAllByRole('button', { name: 'Decline' })).toHaveLength(3);

    await user.click(within(card).getByRole('link', { name: 'See all (5)' }));
    expect(within(card).getAllByRole('listitem')).toHaveLength(5);
    await user.click(within(card).getByRole('link', { name: 'Show fewer' }));
    expect(within(card).getAllByRole('listitem')).toHaveLength(3);
  });

  it('confirms in place: the request leaves and the count follows', async () => {
    const user = userEvent.setup();
    pending = [1, 2].map(request);
    renderCard();
    const card = await screen.findByRole(
      'region',
      { name: /^Requests to confirm\s*2$/ },
      { timeout: 3000 },
    );
    // Two fit everywhere: no "See all".
    expect(within(card).queryByRole('link', { name: /See all/ })).toBeNull();

    await user.click(
      within(within(card).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Confirm' }),
    );
    await waitFor(
      () =>
        expect(
          screen.getByRole('region', { name: /^Requests to confirm\s*1$/ }),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(patches).toEqual([
      { path: '/api/admin/appointments/a1', body: { status: 'confirmed', from: 'pending' } },
    ]);
    expect(m.toast.success).toHaveBeenCalledWith('Booking confirmed');
  });

  it('is not there when nothing waits', async () => {
    pending = [];
    const { container } = renderCard();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    expect(container).toBeEmptyDOMElement();
  });
});
