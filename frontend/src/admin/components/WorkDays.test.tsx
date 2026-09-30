import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import admin from '@/locales/en/admin.json';
import booking from '@/locales/en/booking.json';
import common from '@/locales/en/common.json';
import MySchedulePage from '../pages/MySchedulePage';
import { nextTime, timesIssue } from './sessions';

/*
 * My schedule in working-days mode against a mocked API: the switch, the days already open,
 * and opening new ones. Today is Wednesday 10 June 2026 in Chișinău.
 */

const text = (en: string) => ({ ro: en, ru: en, en });
const staff = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  name: 'Alina',
  title: text('Nail master'),
  color: 'blush',
  userId: 'u-owner',
  serviceIds: null,
  weekly: [0, 1, 2, 3, 4, 5, 6].map((d) => (d < 5 ? [{ start: '10:00', end: '19:00' }] : [])),
  bufferMin: 0,
  scheduleMode: 'days',
  sessionMin: 120,
  isActive: true,
  isBookable: true,
  order: 1,
  ...over,
});
const openDay = { id: 'w1', staffId: 'm1', date: '2026-06-12', times: ['10:00', '12:00', '14:00'], booked: 1 };

let current = staff();
let listed = [openDay];
const sent: Array<{ method: string; path: string; body: unknown }> = [];

function respond(method: string, path: string, body: Record<string, unknown>): unknown {
  if (path === '/api/config') {
    return { auth: { google: false, demo: [] }, studio: { timezone: 'Europe/Chisinau', currency: 'MDL', name: 'Nails by Alynna' }, booking: {}, loyalty: {} };
  }
  if (path === '/api/admin/team/me' && method === 'GET') return { staff: current };
  if (path === '/api/admin/team/me' && method === 'PATCH') {
    current = { ...current, ...body };
    return { staff: current, outsideHours: [] };
  }
  if (path === '/api/admin/team/work-days' && method === 'GET') return { workDays: listed };
  if (path === '/api/admin/team/work-days' && method === 'PUT') {
    const dates = body.dates as string[];
    return { workDays: dates.map((date, i) => ({ id: `n${i}`, staffId: 'm1', date, times: body.times, booked: 0 })), outsideHours: [] };
  }
  if (path === '/api/admin/team/time-off') return { timeOff: [] };
  throw new Error(`Unmocked request: ${method} ${path}`);
}

function renderPage() {
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
        <MemoryRouter initialEntries={['/en/admin/schedule']}>
          <MySchedulePage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  current = staff();
  listed = [openDay];
  sent.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T07:00:00Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (method !== 'GET') sent.push({ method, path: url.pathname, body });
      return new Response(JSON.stringify(respond(method, url.pathname, body)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('start times of a day', () => {
  it('need a start each, a session apart, and to end by midnight', () => {
    expect(timesIssue(['10:00', '13:00', '16:30'], 120)).toBeNull();
    expect(timesIssue(['13:00', '10:00'], 120)).toBeNull();
    expect(timesIssue(['10:00', '11:00'], 120)).toEqual({ issue: 'overlap', first: '10:00', second: '11:00' });
    expect(timesIssue(['10:00', '23:00'], 120)).toEqual({ issue: 'too_late', time: '23:00' });
    expect(timesIssue(['10:00', ''], 120)).toEqual({ issue: 'required' });
    expect(timesIssue([], 120)).toEqual({ issue: 'required' });
  });

  it('add the next booking a session after the latest one', () => {
    expect(nextTime(['10:00', '14:00', '12:00'], 120)).toBe('16:00');
    expect(nextTime(['21:00'], 120)).toBe('22:00');
    expect(nextTime([], 120)).toBe('08:00');
  });
});

describe('My schedule → working days', () => {
  it('shows the days already open instead of the weekly hours', async () => {
    renderPage();
    expect(await screen.findByRole('switch', { name: 'Open working days one by one' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('One booking takes')).toHaveValue('120');
    expect(screen.queryByRole('heading', { name: 'Working hours' })).not.toBeInTheDocument();

    const row = await screen.findByRole('button', { name: /Change Friday,? 12\sJune/ });
    expect(within(row).getByText('10:00 · 12:00 · 14:00')).toBeInTheDocument();
    expect(within(row).getByText(/^3\sbookings/)).toBeInTheDocument();
    expect(within(row).getByText(/1 of 3\sbooked/)).toBeInTheDocument();
  });

  it('opens several days with the start times the master sets', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Open days' }));
    const sheet = await screen.findByRole('dialog', { name: 'Open working days' });

    // Days before today can't be picked; a day already open carries a mark.
    expect(within(sheet).getByRole('button', { name: /Tuesday,? 9\sJune/ })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: /Friday,? 12\sJune.*already open/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /Monday,? 15\sJune/ }));
    await user.click(within(sheet).getByRole('button', { name: /Saturday,? 13\sJune/ }));
    expect(within(sheet).getByText(/2\sdays chosen/)).toBeInTheDocument();

    // Starts from the last day opened: three bookings, each shown with its end.
    const starts = () => within(sheet).getAllByLabelText(/^Booking \d starts at$/).map((input) => (input as HTMLInputElement).value);
    expect(starts()).toEqual(['10:00', '12:00', '14:00']);
    expect(within(sheet).getByText(/until\s12:00/)).toBeInTheDocument();

    // + adds one a session after the last; − and × take one away.
    await user.click(within(sheet).getByRole('button', { name: 'One more booking' }));
    await user.click(within(sheet).getByRole('button', { name: 'Add a booking' }));
    expect(starts()).toEqual(['10:00', '12:00', '14:00', '16:00', '18:00']);
    await user.click(within(sheet).getByRole('button', { name: 'One booking fewer' }));
    await user.click(within(sheet).getByRole('button', { name: 'Remove the 12:00 booking' }));
    expect(starts()).toEqual(['10:00', '14:00', '16:00']);

    // Times closer than a session are refused before anything is sent.
    const first = within(sheet).getByLabelText('Booking 1 starts at');
    await user.clear(first);
    await user.type(first, '13:30');
    await user.click(within(sheet).getByRole('button', { name: /Open 2\sdays/ }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/13:30 and 14:00 are less than 2\sh apart/);
    expect(sent).toEqual([]);

    await user.clear(first);
    await user.type(first, '09:30');
    await user.click(within(sheet).getByRole('button', { name: /Open 2\sdays/ }));
    await waitFor(() =>
      expect(sent).toEqual([
        { method: 'PUT', path: '/api/admin/team/work-days', body: { staffId: 'm1', dates: ['2026-06-13', '2026-06-15'], times: ['09:30', '14:00', '16:00'] } },
      ]),
    );
  });

  it('a weekday letter picks every such day left in the month', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Open days' }));
    const sheet = await screen.findByRole('dialog', { name: 'Open working days' });
    await user.click(within(sheet).getByRole('button', { name: /Every Tuesday left/ }));
    // 9 June is past: the 16th, 23rd and 30th.
    expect(within(sheet).getByText(/3\sdays chosen/)).toBeInTheDocument();
    for (const day of ['16', '23', '30']) {
      expect(within(sheet).getByRole('button', { name: new RegExp(`Tuesday,? ${day}\\sJune`) })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('lists the next few days, and the rest on request', async () => {
    const user = userEvent.setup();
    listed = ['2026-06-12', '2026-06-13', '2026-06-15', '2026-06-16', '2026-06-18', '2026-06-19'].map((date, i) => ({ ...openDay, id: `w${i}`, date }));
    renderPage();
    const more = await screen.findByRole('button', { name: /Show 2\smore days/ });
    expect(screen.getAllByRole('button', { name: /^Change / })).toHaveLength(4);
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(screen.getAllByRole('button', { name: /^Change / })).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('button', { name: /^Change / })).toHaveLength(4);
  });

  it('switched off, the weekly hours come back', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'Open working days one by one' }));
    await waitFor(() => expect(sent).toEqual([{ method: 'PATCH', path: '/api/admin/team/me', body: { scheduleMode: 'weekly' } }]));
    expect(await screen.findByRole('heading', { name: 'Working hours' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Working days' })).not.toBeInTheDocument();
  });
});
