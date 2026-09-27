import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { useState, type ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '@/components/ui';
import type * as UiModule from '@/components/ui';
import { addDays, zonedDate } from '@/lib/format';
import admin from '@/locales/en/admin.json';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import type { StaffAppointment } from '@/types/api';
import { adminQueries } from '../api';
import { zonedTimeToUtc } from '../components/time';
import { PendingRequestsSheet } from './PendingRequestsSheet';

/*
 * "New requests (N)" comes up each time a staff member opens the app with requests waiting for
 * them: at the page load, and on coming back after 30 s or more away. Never over another sheet.
 */

const m = vi.hoisted(() => ({
  user: { id: 'u0', role: 'administrator' } as { id: string; role: string },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('@/app/auth', () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  toast: m.toast,
}));

const TZ = 'Europe/Chisinau';
const text = (en: string) => ({ ro: en, ru: en, en });
const master = (id: string, name: string) => ({
  id,
  name,
  title: text('Nail master'),
  color: 'blush',
  userId: null,
  serviceIds: null,
  weekly: [],
  isActive: true,
  isBookable: true,
  order: 1,
});

/** The clock the app reads: it only moves forward, when a test says so. */
let clock = Date.now();
/** A day and wall-clock time in the studio, `days` from today. */
const at = (days: number, time: string) =>
  zonedTimeToUtc(addDays(zonedDate(new Date(clock), TZ), days), time, TZ).toISOString();

function request(id: string, over: Partial<StaffAppointment> & { name: string }): StaffAppointment {
  const { name, ...rest } = over;
  const start = rest.start ?? at(1, '14:00');
  return {
    id,
    code: id.toUpperCase(),
    status: 'pending',
    start,
    end: new Date(new Date(start).getTime() + 90 * 60_000).toISOString(),
    durationMin: 90,
    totalPrice: 450,
    priceFrom: false,
    services: [
      { id: 's1', name: text('Gel polish'), durationMin: 90, price: 450, priceFrom: false },
    ],
    nailShape: null,
    staff: { id: 'm1', name: 'Alina', title: text('Nail master'), color: 'blush' },
    notes: '',
    canChange: true,
    changeDeadline: start,
    cancelledAt: null,
    cancelledBy: null,
    loyalty: null,
    createdAt: new Date(clock - 5 * 60_000).toISOString(),
    client: {
      id: `c-${id}`,
      name,
      surname: 'Popescu',
      phone: '+37369000111',
      email: `${id}@example.com`,
    },
    staffNotes: '',
    source: 'client',
    cancelReason: '',
    clientStats: { visits: 0, noShows: 0 },
    ...rest,
  };
}

/** What the API holds: the requests (already scoped to the signed-in person) and the team. */
const server = {
  pending: [] as StaffAppointment[],
  scope: 'all' as 'all' | 'own',
  staff: [master('m1', 'Alina')],
  patches: [] as Array<{ id: string; body: Record<string, unknown> }>,
};

function Where() {
  return <p data-testid="where">{useLocation().pathname + useLocation().search}</p>;
}

/** Another sheet that came up first (e.g. "Turn on notifications"). */
function OtherSheet() {
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Turn on notifications">
      <button type="button" onClick={() => setOpen(false)}>
        Not now
      </button>
    </Sheet>
  );
}

let queryClient: QueryClient;
let people = 0;

/**
 * The staff screens at `url`, for a new person unless `same` (each person has their own
 * openings, so tests don't share them).
 */
function openApp(
  url = '/en/admin',
  { role = 'administrator', extra = null as ReactNode, same = false } = {},
) {
  m.user = { id: same ? m.user.id : `u${++people}`, role };
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
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = (
    <>
      {extra}
      <PendingRequestsSheet />
      <Where />
    </>
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/en/admin" element={app} />
            <Route path="/en/admin/appointments/:id" element={app} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const requestsSheet = () => screen.queryByRole('dialog', { name: /^New requests/ });
/** The sheet coming up: the fetch, then the beat after other dialogs (slower on a busy test run). */
const requestsSheetNamed = (name: string) =>
  screen.findByRole('dialog', { name }, { timeout: 3000 });
/** Long enough for the sheet to have come up if it were going to (fetch + the beat). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 1000)));

/** The app goes to the background for `ms`, then comes back. */
async function away(ms: number) {
  const show = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  };
  await act(async () => {
    show('hidden');
    clock += ms;
    show('visible');
  });
}

beforeEach(() => {
  server.pending = [];
  server.scope = 'all';
  server.staff = [master('m1', 'Alina')];
  server.patches = [];
  m.toast.mockReset();
  m.toast.success.mockReset();
  m.toast.error.mockReset();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (path === '/api/admin/appointments/pending') {
        return json({
          appointments: server.pending,
          total: server.pending.length,
          scope: server.scope,
        });
      }
      if (path.startsWith('/api/admin/appointments/') && init?.method === 'PATCH') {
        const id = path.split('/').pop()!;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        server.patches.push({ id, body });
        const found = server.pending.find((a) => a.id === id)!;
        server.pending = server.pending.filter((a) => a.id !== id);
        return json({ appointment: { ...found, status: body.status } });
      }
      if (path === '/api/admin/team/staff') return json({ staff: server.staff });
      if (path === '/api/config') return json({ studio: { timezone: TZ, currency: 'MDL' } });
      throw new Error(`Unmocked request: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
  // Sheets close at once (reduced motion), so a closed one is gone by the next assertion.
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the "New requests" sheet', () => {
  it('comes up when the app opens with requests waiting: the oldest first, with what each one is', async () => {
    server.pending = [
      request('a1', {
        name: 'Maria',
        start: at(1, '14:00'),
        nailShape: 'almond',
        createdAt: new Date(clock - 2 * 3_600_000).toISOString(),
      }),
      request('a2', {
        name: 'Elena',
        start: at(0, '23:30'),
        clientStats: { visits: 2, noShows: 1 },
      }),
    ];
    openApp();

    const sheet = await requestsSheetNamed('New requests (2)');
    const [first, second] = within(sheet).getAllByRole('listitem');
    expect(first).toHaveTextContent('Maria Popescu');
    expect(first).toHaveTextContent('Sent 2 hours ago');
    expect(first).toHaveTextContent('Tomorrow, 14:00');
    expect(first).toHaveTextContent('Gel polish');
    expect(first).toHaveTextContent('Nail shape: Almond');
    expect(second).toHaveTextContent('Elena Popescu');
    expect(second).toHaveTextContent('Today, 23:30');
    expect(second).toHaveTextContent('1 no-show');
    // One master in the studio: no names to tell apart.
    expect(sheet).not.toHaveTextContent('Alina');
    expect(within(first!).getByRole('link', { name: /Maria Popescu/ })).toHaveAttribute(
      'href',
      '/en/admin/appointments/a1',
    );
    expect(within(sheet).getByRole('button', { name: 'Later' })).toBeInTheDocument();
    // Six at most, then the full list.
    expect(within(sheet).queryByRole('link', { name: /See all/ })).toBeNull();
  });

  it('stays closed when nothing waits, and a request arriving later waits for the next opening', async () => {
    openApp();
    await settle();
    expect(requestsSheet()).toBeNull();

    server.pending = [request('a1', { name: 'Maria' })];
    await act(() =>
      queryClient.invalidateQueries({ queryKey: adminQueries.pendingRequests().queryKey }),
    );
    await settle();
    expect(requestsSheet()).toBeNull();

    await away(31_000);
    expect(await requestsSheetNamed('New requests (1)')).toBeInTheDocument();
  });

  it('shows the owner whose each request is, and a master just theirs', async () => {
    server.staff = [master('m1', 'Alina'), master('m2', 'Irina')];
    server.pending = [
      request('a1', { name: 'Maria' }),
      request('a2', {
        name: 'Olga',
        staff: { id: 'm2', name: 'Irina', title: text('Nail master'), color: 'cyan' },
      }),
    ];
    const owner = openApp();
    const sheet = await requestsSheetNamed('New requests (2)');
    const [first, second] = within(sheet).getAllByRole('listitem');
    expect(first).toHaveTextContent('Tomorrow, 14:00 · Alina');
    expect(second).toHaveTextContent('Tomorrow, 14:00 · Irina');
    owner.unmount();

    // The API only gives Irina her own requests; they need no name.
    server.scope = 'own';
    server.pending = [server.pending[1]!];
    openApp('/en/admin', { role: 'admin' });
    const mine = await requestsSheetNamed('New requests (1)');
    expect(within(mine).getByRole('listitem')).toHaveTextContent('Olga Popescu');
    expect(mine).not.toHaveTextContent('Irina');
  });

  it('answers in place: Confirm, then Decline with a reason; the last answer closes it', async () => {
    const user = userEvent.setup();
    server.pending = [request('a1', { name: 'Maria' }), request('a2', { name: 'Elena' })];
    openApp();
    const sheet = await requestsSheetNamed('New requests (2)');

    await user.click(
      within(within(sheet).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Confirm' }),
    );
    await waitFor(() => expect(within(sheet).getAllByRole('listitem')).toHaveLength(1), {
      timeout: 3000,
    });
    expect(server.patches).toEqual([{ id: 'a1', body: { status: 'confirmed', from: 'pending' } }]);
    expect(m.toast.success).toHaveBeenCalledWith('Booking confirmed');
    expect(screen.getByRole('dialog', { name: 'New requests (1)' })).toBe(sheet);

    await user.click(within(sheet).getByRole('button', { name: 'Decline' }));
    const decline = await screen.findByRole(
      'dialog',
      { name: 'Decline this request?' },
      { timeout: 3000 },
    );
    await user.type(within(decline).getByLabelText(/Reason/), 'Fully booked that day');
    await user.click(within(decline).getByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(requestsSheet()).toBeNull(), { timeout: 3000 });
    expect(server.patches[1]).toEqual({
      id: 'a2',
      body: { status: 'cancelled', cancelReason: 'Fully booked that day', from: 'pending' },
    });
    expect(m.toast.success).toHaveBeenCalledWith('Request declined');
    expect(m.toast.success).toHaveBeenCalledWith('All requests are answered', expect.anything());
  });

  it('"Later" puts it away until the next opening', async () => {
    const user = userEvent.setup();
    server.pending = [request('a1', { name: 'Maria' })];
    const first = openApp();
    const sheet = await requestsSheetNamed('New requests (1)');
    await user.click(within(sheet).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(requestsSheet()).toBeNull(), { timeout: 3000 });

    // Leaving the staff screens and coming back is the same opening; so is a short trip away.
    first.unmount();
    openApp('/en/admin', { same: true });
    await settle();
    expect(requestsSheet()).toBeNull();
    await away(10_000);
    await settle();
    expect(requestsSheet()).toBeNull();

    await away(31_000);
    expect(await requestsSheetNamed('New requests (1)')).toBeInTheDocument();
  });

  it('waits while another sheet is open, and comes up once it closes', async () => {
    const user = userEvent.setup();
    server.pending = [request('a1', { name: 'Maria' })];
    openApp('/en/admin', { extra: <OtherSheet /> });
    const other = screen.getByRole('dialog', { name: 'Turn on notifications' });
    await settle();
    expect(requestsSheet()).toBeNull();

    await user.click(within(other).getByRole('button', { name: 'Not now' }));
    expect(await requestsSheetNamed('New requests (1)')).toBeInTheDocument();
  });

  it('stays away when the app opens on a booking (a notification brought them there)', async () => {
    server.pending = [request('a1', { name: 'Maria' })];
    openApp('/en/admin/appointments/a1');
    await settle();
    expect(requestsSheet()).toBeNull();
  });

  it('"See all" leads to the full list when there are more than six', async () => {
    const user = userEvent.setup();
    server.pending = Array.from({ length: 8 }, (_, i) => request(`a${i}`, { name: `Client${i}` }));
    openApp();
    const sheet = await requestsSheetNamed('New requests (8)');
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(6);
    await user.click(within(sheet).getByRole('link', { name: 'See all (8)' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/en/admin?requests=all');
    await waitFor(() => expect(requestsSheet()).toBeNull(), { timeout: 3000 });
  });
});
