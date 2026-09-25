import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/app/auth';
import admin from '@/locales/en/admin.json';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import AppointmentPage from '../pages/AppointmentPage';
import AuditPage from '../pages/AuditPage';
import CalendarPage from '../pages/CalendarPage';
import ClientPage from '../pages/ClientPage';
import ClientsPage from '../pages/ClientsPage';
import DashboardPage from '../pages/DashboardPage';
import NewAppointmentPage from '../pages/NewAppointmentPage';
import SettingsPage from '../pages/SettingsPage';
import TeamPage from '../pages/TeamPage';
import UsersPage from '../pages/UsersPage';

/*
 * Every staff screen rendered against a mocked API with realistic payloads (the shapes of
 * backend/src/modules/admin/*): no crash, real content on screen, no untranslated key.
 */

const text = (en: string) => ({ ro: en, ru: en, en });
const owner = {
  id: 'u-owner',
  email: 'owner@example.com',
  name: 'Alina',
  surname: 'Rusu',
  phone: '+37369123456',
  role: 'administrator',
  locale: 'en',
  hasPassword: true,
  hasGoogle: false,
  bookingBlocked: false,
  isDemo: false,
  createdAt: '2026-01-01T09:00:00.000Z',
};
const master = {
  id: 'm1',
  name: 'Alina',
  title: text('Nail master'),
  color: 'blush',
  userId: null,
  serviceIds: null,
  weekly: [0, 1, 2, 3, 4, 5, 6].map((d) => (d < 5 ? [{ start: '10:00', end: '19:00' }] : [])),
  isActive: true,
  isBookable: true,
  order: 1,
};
const appointment = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  code: 'A7K2Q9',
  status: 'confirmed',
  start: '2026-09-25T11:00:00.000Z',
  end: '2026-09-25T12:30:00.000Z',
  durationMin: 90,
  totalPrice: 450,
  priceFrom: false,
  services: [{ id: 's1', name: text('Gel polish'), durationMin: 90, price: 450, priceFrom: false }],
  staff: { id: 'm1', name: 'Alina', title: text('Nail master'), color: 'blush' },
  notes: 'Pastel colours',
  canChange: true,
  changeDeadline: '2026-09-24T23:00:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  createdAt: '2026-09-20T10:00:00.000Z',
  client: { id: 'c1', name: 'Maria', surname: 'Popescu', phone: '+37369000111', email: 'client+c1@no-email.invalid' },
  staffNotes: 'Sensitive cuticles',
  source: 'staff',
  cancelReason: '',
  clientStats: { visits: 3, noShows: 1 },
  loyalty: null,
  ...over,
});
const client = {
  id: 'c1',
  name: 'Maria',
  surname: 'Popescu',
  email: null,
  phone: '+37369000111',
  locale: 'ro',
  isActive: true,
  bookingBlocked: false,
  hasAccount: false,
  createdAt: '2026-03-02T10:00:00.000Z',
  lastLoginAt: null,
};
const settings = {
  name: 'Nails by Alynna',
  legalName: '',
  legalId: '',
  tagline: text('Your nails. Your rules.'),
  about: text('About'),
  address: 'Str. Exemplu 1',
  city: 'Chișinău',
  mapsUrl: '',
  phone: '+37368230429',
  whatsapp: '',
  viber: '',
  telegram: '',
  instagram: '_nailsbyalynna_',
  email: '',
  timezone: 'Europe/Chisinau',
  currency: 'MDL',
  slotStepMin: 15,
  leadTimeMin: 120,
  horizonDays: 60,
  cancellationWindowHours: 12,
  requireApproval: false,
  bufferMin: 0,
  maxActiveBookings: 3,
  policy: text('Policy'),
};

function respond(path: string): unknown {
  if (path === '/api/config') {
    return {
      auth: { google: false, demo: [] },
      studio: { ...settings, tagline: settings.tagline, about: settings.about },
      booking: { requireApproval: false, cancellationWindowHours: 12, leadTimeMin: 120, horizonDays: 60, maxActiveBookings: 3, policy: settings.policy, mastersCount: 1 },
      loyalty: { enabled: true, cycle: 8, rewards: [] },
    };
  }
  if (path === '/api/admin/stats') {
    return {
      date: '2026-09-25',
      today: { total: 1, pending: 0, confirmed: 1, completed: 0, noShow: 0, expectedRevenue: 450, occupancy: 0.2, appointments: [appointment()] },
      week: { from: '2026-09-21', appointments: 6, completedRevenue: 1800, expectedRevenue: 2700 },
      pendingApprovals: 1,
      next7Days: 5,
      newClientsThisMonth: 2,
      topServices: [{ id: 's1', name: text('Gel polish'), count: 12 }],
      currency: 'MDL',
    };
  }
  if (path === '/api/admin/appointments') {
    return { appointments: [appointment(), appointment({ id: 'a2', code: 'B2', status: 'pending', start: '2026-09-26T08:00:00.000Z', end: '2026-09-26T09:30:00.000Z' })] };
  }
  if (path.startsWith('/api/admin/appointments/')) return { appointment: appointment() };
  if (path === '/api/admin/catalog') {
    return {
      categories: [{ id: 'k1', slug: 'gel', name: text('Gel'), description: null, singleChoice: false, color: 'blush', order: 1, isActive: true, isDefault: true, isLegacy: false, customized: [] }],
      services: [
        { id: 's1', categoryId: 'k1', slug: 'gel', name: text('Gel polish'), description: text(''), durationMin: 90, price: 450, priceFrom: false, art: 'gel', isPopular: true, order: 1, isActive: true, isDefault: true, isLegacy: false, customized: [] },
      ],
    };
  }
  if (path === '/api/admin/team/staff') return { staff: [master] };
  if (path === '/api/admin/team/time-off') {
    return { timeOff: [{ id: 't1', staffId: 'm1', start: '2030-01-10T22:00:00.000Z', end: '2030-01-12T22:00:00.000Z', reason: 'Holiday', createdAt: '2026-09-01T10:00:00.000Z' }] };
  }
  if (path === '/api/admin/clients') {
    return { clients: [{ ...client, stats: { visits: 3, noShows: 1, upcoming: 1, lastVisit: '2026-09-01T10:00:00.000Z', spent: 1350 } }], total: 1, page: 1, pages: 1 };
  }
  if (path.startsWith('/api/admin/clients/')) {
    return { client: { ...client, notes: 'Prefers mornings' }, stats: { visits: 3, noShows: 1, cancelled: 0, spent: 1350 }, appointments: [appointment()] };
  }
  if (path === '/api/admin/settings') return { settings };
  if (path === '/api/admin/users') {
    return {
      users: [{ ...owner, hasAccount: true, isActive: true, lastLoginAt: '2026-09-25T08:00:00.000Z' }, { ...client, role: 'client', email: null }],
      total: 2,
      page: 1,
      pages: 1,
    };
  }
  if (path === '/api/availability/days') {
    return {
      durationMin: 90,
      window: { first: '2030-03-04', last: '2030-05-03' },
      staffCount: 1,
      days: [
        { date: '2030-03-04', slots: 0 },
        { date: '2030-03-05', slots: 2 },
        { date: '2030-03-06', slots: 5 },
      ],
    };
  }
  if (path === '/api/availability/slots') {
    return {
      date: '2030-03-05',
      durationMin: 90,
      slots: [
        { start: '2030-03-05T08:00:00.000Z', time: '10:00', staffIds: ['m1'] },
        { start: '2030-03-05T12:00:00.000Z', time: '14:00', staffIds: ['m1'] },
      ],
    };
  }
  if (path === '/api/admin/audit') {
    return {
      logs: [
        { id: 'l1', at: new Date().toISOString(), action: 'appointment.status', actor: { name: 'Alina', surname: 'Rusu', role: 'administrator' }, targetType: 'appointment', targetId: 'a1', meta: { from: 'pending', to: 'confirmed' } },
        { id: 'l2', at: new Date().toISOString(), action: 'service.update', actor: { name: 'Alina', surname: 'Rusu', role: 'administrator' }, targetType: 'service', targetId: 's1', meta: { fields: ['price', 'name'], price: { from: 400, to: 450 } } },
        { id: 'l3', at: new Date().toISOString(), action: 'something.new', actor: null, targetType: 'x', targetId: null, meta: {} },
      ],
    };
  }
  throw new Error(`Unmocked request: ${path}`);
}

function renderScreen(element: ReactElement, path: string, url: string) {
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
  queryClient.setQueryData(['me'], owner);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route path={path} element={element} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/** Text nodes that are an untranslated key (i18next shows the key itself when one is missing). */
function leakedKeys(): string[] {
  const raw = /^(?:dashboard|calendar|appointment|booking|clients|client|team|timeOff|hours|settings|users|audit|invite|status|pagination|nav|common)\.[\w.]+$/;
  const found: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent?.trim() ?? '';
    if (raw.test(value)) found.push(value);
  }
  for (const el of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
    for (const attr of ['aria-label', 'placeholder', 'title']) {
      const value = el.getAttribute(attr)?.trim() ?? '';
      if (raw.test(value)) found.push(`${attr}=${value}`);
    }
  }
  return found;
}

const posts: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (init?.method === 'PATCH') {
        const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        posts.push({ path, body });
        return new Response(JSON.stringify({ appointment: appointment({ status: body.status ?? 'confirmed', cancelledBy: 'staff', cancelledAt: '2026-09-25T09:00:00.000Z' }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (init?.method === 'POST') {
        const body = init.body ? (JSON.parse(String(init.body)) as unknown) : null;
        posts.push({ path, body });
        const created =
          path === '/api/admin/appointments'
            ? { appointment: appointment({ id: 'a9', code: 'NEW1', client: { id: 'c9', name: 'Ana', surname: 'Rusu', phone: '+37369123123', email: 'client+c9@no-email.invalid' } }) }
            : { url: 'https://nailsbyalynna.md/signup?invite=token123', expiresAt: '2026-10-09T10:00:00.000Z' };
        return new Response(JSON.stringify(created), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(respond(path)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('staff screens', () => {
  it('Dashboard: next visit, requests, schedule and numbers', async () => {
    renderScreen(<DashboardPage />, '/en/admin', '/en/admin');
    expect(await screen.findByText('Requests to confirm')).toBeInTheDocument();
    expect(screen.getAllByText('Maria Popescu').length).toBeGreaterThan(0);
    expect(screen.getByText('In numbers')).toBeInTheDocument();
    expect(screen.getByText('Most booked, 30 days')).toBeInTheDocument();
    expect(leakedKeys()).toEqual([]);
  });

  it('Calendar: the chosen day with its bookings', async () => {
    renderScreen(<CalendarPage />, '/en/admin/calendar', '/en/admin/calendar?date=2026-09-25');
    expect(await screen.findByText('Maria Popescu')).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Days' })).toBeInTheDocument();
    expect(leakedKeys()).toEqual([]);
  });

  it('Booking: facts, actions, notes and the client', async () => {
    renderScreen(<AppointmentPage />, '/en/admin/appointments/:id', '/en/admin/appointments/a1');
    expect(await screen.findByText('Reschedule')).toBeInTheDocument();
    expect(screen.getByText('Private note')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sensitive cuticles')).toBeInTheDocument();
    expect(leakedKeys()).toEqual([]);
  });

  it('New booking: the whole flow renders, with clients to pick from', async () => {
    renderScreen(<NewAppointmentPage />, '/en/admin/appointments/new', '/en/admin/appointments/new');
    expect(await screen.findByText('Who is it for?')).toBeInTheDocument();
    expect(await screen.findByText('Maria Popescu')).toBeInTheDocument();
    expect(await screen.findAllByText('Gel polish')).not.toHaveLength(0);
    expect(leakedKeys()).toEqual([]);
  });

  it('New booking: ?clientId= preselects the client', async () => {
    renderScreen(<NewAppointmentPage />, '/en/admin/appointments/new', '/en/admin/appointments/new?clientId=c1');
    expect(await screen.findByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('Clients: searchable list with stats', async () => {
    renderScreen(<ClientsPage />, '/en/admin/clients', '/en/admin/clients');
    expect(await screen.findByText('Maria Popescu')).toBeInTheDocument();
    expect(screen.getByText('1 client')).toBeInTheDocument();
    expect(leakedKeys()).toEqual([]);
  });

  it('Client: contact, invite, visits and details', async () => {
    renderScreen(<ClientPage />, '/en/admin/clients/:id', '/en/admin/clients/c1');
    expect(await screen.findByText('Not in the app yet')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Prefers mornings')).toBeInTheDocument();
    expect(screen.getByText('Online booking')).toBeInTheDocument();
    expect(leakedKeys()).toEqual([]);
  });

  it('Team: masters and time off', async () => {
    renderScreen(<TeamPage />, '/en/admin/team', '/en/admin/team');
    expect(await screen.findByText('Mon–Fri 10:00–19:00')).toBeInTheDocument();
    expect(await screen.findByText('Holiday')).toBeInTheDocument();
    expect(leakedKeys()).toEqual([]);
  });

  it('Settings: sections with their fields', async () => {
    renderScreen(<SettingsPage />, '/en/admin/settings', '/en/admin/settings');
    expect(await screen.findByDisplayValue('Nails by Alynna')).toBeInTheDocument();
    expect(screen.getByText('Booking rules')).toBeInTheDocument();
    expect(leakedKeys()).toEqual([]);
  });

  it('Users: accounts with roles', async () => {
    renderScreen(<UsersPage />, '/en/admin/users', '/en/admin/users');
    expect(await screen.findByText('2 accounts')).toBeInTheDocument();
    expect(screen.getAllByText('Owner').length).toBeGreaterThan(0);
    expect(leakedKeys()).toEqual([]);
  });

  it('Activity log: readable entries, raw action as a fallback', async () => {
    renderScreen(<AuditPage />, '/en/admin/audit', '/en/admin/audit');
    expect(await screen.findByText('Booking status changed')).toBeInTheDocument();
    expect(screen.getByText('Request → Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Price: 400 MDL → 450 MDL')).toBeInTheDocument();
    expect(screen.getByText('something.new')).toBeInTheDocument();
    expect(leakedKeys()).toEqual([]);
  });
});

describe('new booking flow', () => {
  it('books a walk-in at a typed time, then offers the QR invite', async () => {
    const user = userEvent.setup();
    renderScreen(<NewAppointmentPage />, '/en/admin/appointments/new', '/en/admin/appointments/new');

    // 1. A new client, typed at the desk.
    await user.click(await screen.findByRole('tab', { name: 'New client' }));
    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.type(screen.getByLabelText('Last name'), 'Rusu');
    await user.type(screen.getByLabelText('Phone'), '069 123 123');

    // 2. A service.
    await user.click(await screen.findByRole('button', { name: /Gel polish/ }));

    // 3. A typed time (the free-times view needs the availability API).
    await user.click(screen.getByRole('tab', { name: 'Other time' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-02' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:30' } });

    // 4. Book.
    await user.click(screen.getByRole('button', { name: 'Create booking' }));

    await waitFor(() => expect(posts.some((p) => p.path === '/api/admin/appointments')).toBe(true));
    expect(posts.find((p) => p.path === '/api/admin/appointments')?.body).toEqual({
      newClient: { name: 'Ana', surname: 'Rusu', phone: '069 123 123' },
      serviceIds: ['s1'],
      staffId: null,
      // 14:30 in Chișinău (summer time, UTC+3).
      start: '2026-10-02T11:30:00.000Z',
      notes: '',
      status: 'confirmed',
      force: false,
    });

    // 5. Done, and the walk-in gets an invite straight away.
    expect(await screen.findByText('Booked!')).toBeInTheDocument();
    const invite = await screen.findByRole('dialog');
    expect(await within(invite).findByRole('img', { name: 'QR code with the invite link for Ana' })).toBeInTheDocument();
    expect(posts.some((p) => p.path === '/api/admin/clients/c9/invite')).toBe(true);
    expect(within(invite).getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', expect.stringContaining('https://wa.me/37369123123?text='));
  });

  it('books an existing client at a free time, with the master who is free then', async () => {
    const user = userEvent.setup();
    renderScreen(<NewAppointmentPage />, '/en/admin/appointments/new', '/en/admin/appointments/new');
    await user.click(await screen.findByRole('button', { name: /Maria Popescu/ }));
    await user.click(await screen.findByRole('button', { name: /Gel polish/ }));
    // The first day with room opens by itself; days without room can't be picked.
    await user.click(await screen.findByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: 'Create booking' }));

    await waitFor(() => expect(posts.some((p) => p.path === '/api/admin/appointments')).toBe(true));
    expect(posts.find((p) => p.path === '/api/admin/appointments')?.body).toEqual({
      clientId: 'c1',
      serviceIds: ['s1'],
      staffId: 'm1',
      start: '2030-03-05T08:00:00.000Z',
      notes: '',
      status: 'confirmed',
      force: false,
    });
  });

  it('will not book without the essentials, and says what is missing', async () => {
    const user = userEvent.setup();
    renderScreen(<NewAppointmentPage />, '/en/admin/appointments/new', '/en/admin/appointments/new');
    await user.click(await screen.findByRole('button', { name: 'Create booking' }));
    expect(await screen.findByText('Choose a client, or add a new one.')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one service.')).toBeInTheDocument();
    expect(screen.getByText('Choose a time.')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });
});

describe('booking actions', () => {
  it('cancels only after a confirmation, sending the reason', async () => {
    const user = userEvent.setup();
    renderScreen(<AppointmentPage />, '/en/admin/appointments/:id', '/en/admin/appointments/a1');
    await user.click(await screen.findByRole('button', { name: 'Cancel booking' }));
    expect(posts).toHaveLength(0);

    const sheet = await screen.findByRole('dialog', { name: 'Cancel this booking?' });
    await user.type(within(sheet).getByLabelText('Reason (optional)'), 'Client called');
    await user.click(within(sheet).getByRole('button', { name: 'Yes, cancel' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: '/api/admin/appointments/a1', body: { status: 'cancelled', cancelReason: 'Client called' } });
  });
});
