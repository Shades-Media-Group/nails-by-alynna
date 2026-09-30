import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UiModule from '@/components/ui';
import admin from '@/locales/en/admin.json';
import common from '@/locales/en/common.json';
import type { CalendarSyncState } from '../api';
import { CalendarSync } from './CalendarSync';

/*
 * My schedule → Calendar sync: Google Calendar and Apple Calendar connected directly (instant),
 * above the subscription link.
 */

const m = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
  leaveFor: vi.fn(),
}));
vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  toast: m.toast,
}));
vi.mock('@/lib/leave', () => ({ leaveFor: m.leaveFor }));

const off = (): CalendarSyncState => ({
  feed: null,
  google: { available: true, connected: false, needsReconnect: false, email: null, lastSyncAt: null },
  apple: { connected: false, needsReconnect: false, appleId: null, lastSyncAt: null },
});

let state: CalendarSyncState;
const calls: Array<{ method: string; path: string; body: unknown }> = [];
/** Answers that differ from the usual one, by "METHOD path". */
let refusals: Record<string, { status: number; body: unknown }> = {};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  state = off();
  calls.length = 0;
  refusals = {};
  m.leaveFor.mockReset();
  m.toast.success.mockReset();
  m.toast.error.mockReset();
  m.toast.info.mockReset();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
      calls.push({ method, path, body });
      const refusal = refusals[`${method} ${path}`];
      if (refusal) return json(refusal.body, refusal.status);
      if (path === '/api/admin/team/me/calendar/google' && method === 'POST') return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=cal.x' });
      if (path === '/api/admin/team/me/calendar/google' && method === 'DELETE') state = { ...state, google: off().google };
      if (path === '/api/admin/team/me/calendar/apple' && method === 'POST') {
        state = { ...state, apple: { connected: true, needsReconnect: false, appleId: 'al•••@icloud.com', lastSyncAt: null } };
        return json(state, 201);
      }
      if (path === '/api/admin/team/me/calendar/apple' && method === 'DELETE') state = { ...state, apple: off().apple };
      return json(state);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function Address() {
  const location = useLocation();
  return <output data-testid="address">{location.pathname + location.search}</output>;
}

function renderSync(url = '/admin/schedule') {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['admin', 'common'],
    defaultNS: 'common',
    resources: { en: { admin, common } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>
          <CalendarSync />
          <Address />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const row = (name: string) => screen.getByText(name, { selector: 'span' }).closest('li')!;

describe('Calendar sync → Instant sync', () => {
  it('offers Google Calendar and Apple Calendar above the subscription', async () => {
    renderSync();
    expect(await screen.findByRole('heading', { name: 'Instant sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Connect Apple Calendar (iCloud)' })).toBeEnabled();
    expect(screen.getByText('Adds a calendar just for your bookings to your Google account')).toBeInTheDocument();
    // The subscription stays, below, as the slower way.
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.indexOf('Instant sync')).toBeLessThan(headings.indexOf('Or subscribe (updates every few hours)'));
    expect(screen.getByRole('button', { name: 'Turn on calendar sync' })).toBeInTheDocument();
  });

  it('sends the master to Google, and says how it went when Google sends them back', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSync();
    await user.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }));
    await waitFor(() => expect(m.leaveFor).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=cal.x'));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/team/me/calendar/google')).toBe(true);
    unmount();

    state = { ...state, google: { available: true, connected: true, needsReconnect: false, email: 'alina@gmail.com', lastSyncAt: null } };
    renderSync('/admin/schedule?calendar=google_connected');
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Google Calendar connected. Your bookings are on their way'));
    // The note is read once: the address is tidied.
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(/^\/admin\/schedule$/));
    const google = row('Google Calendar');
    expect(await within(google).findByText('alina@gmail.com')).toBeInTheDocument();
    expect(within(google).getByText('Connected')).toBeInTheDocument();
    expect(within(google).getByRole('button', { name: 'Sync Google Calendar now' })).toBeInTheDocument();
    expect(m.toast.success).toHaveBeenCalledTimes(1);
  });

  it('explains an unticked permission on the way back', async () => {
    renderSync('/admin/schedule?calendar=google_scope');
    await waitFor(() =>
      expect(m.toast.error).toHaveBeenCalledWith('Google Calendar needs permission to add its calendar. Connect again and leave the calendar box ticked'),
    );
  });

  it('connects Apple Calendar with an Apple ID and an app-specific password, and says when Apple refuses them', async () => {
    const user = userEvent.setup();
    refusals['POST /api/admin/team/me/calendar/apple'] = {
      status: 422,
      body: { error: { code: 'CALENDAR_AUTH', message: 'refused', fields: { password: 'apple_auth' } } },
    };
    renderSync();
    await user.click(await screen.findByRole('button', { name: 'Connect Apple Calendar (iCloud)' }));
    const sheet = await screen.findByRole('dialog', { name: 'Connect Apple Calendar' });
    // How to make the password, with the way to Apple's page.
    expect(within(sheet).getByRole('link', { name: 'account.apple.com' })).toHaveAttribute('href', 'https://account.apple.com');
    expect(within(sheet).getByText('Choose Sign-In and Security → App-Specific Passwords.')).toBeInTheDocument();

    // Nothing typed: both fields asked for.
    await user.click(within(sheet).getByRole('button', { name: 'Connect Apple Calendar' }));
    expect(within(sheet).getAllByText('Required')).toHaveLength(2);
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/apple'))).toBe(false);

    await user.type(within(sheet).getByLabelText('Apple ID (email)'), 'alina@icloud.com');
    await user.type(within(sheet).getByLabelText('App-specific password'), 'abcd-efgh-ijkl-mnop');
    await user.click(within(sheet).getByRole('button', { name: 'Connect Apple Calendar' }));
    expect(
      await within(sheet).findByText("Apple didn't accept this Apple ID and password. Check the email, or make a new app-specific password."),
    ).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { appleId: 'alina@icloud.com', password: 'abcd-efgh-ijkl-mnop' } });

    // iCloud down: said as such.
    refusals['POST /api/admin/team/me/calendar/apple'] = { status: 502, body: { error: { code: 'CALENDAR_UNREACHABLE', message: 'down' } } };
    await user.click(within(sheet).getByRole('button', { name: 'Connect Apple Calendar' }));
    expect(await within(sheet).findByText("Couldn't reach iCloud just now. Please try again in a minute.")).toBeInTheDocument();

    delete refusals['POST /api/admin/team/me/calendar/apple'];
    await user.click(within(sheet).getByRole('button', { name: 'Connect Apple Calendar' }));
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Apple Calendar connected. Your bookings are on their way'));
    const apple = row('Apple Calendar (iCloud)');
    expect(within(apple).getByText('al•••@icloud.com')).toBeInTheDocument();
    expect(within(apple).getByText('Connected')).toBeInTheDocument();
  });

  it('syncs now and disconnects after asking', async () => {
    const user = userEvent.setup();
    state = { ...state, apple: { connected: true, needsReconnect: false, appleId: 'al•••@icloud.com', lastSyncAt: null } };
    renderSync();
    await user.click(await screen.findByRole('button', { name: 'Sync Apple Calendar (iCloud) now' }));
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Syncing: your calendar catches up within a minute'));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/team/me/calendar/sync')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Disconnect Apple Calendar (iCloud)' }));
    const confirm = await screen.findByRole('dialog', { name: 'Disconnect Apple Calendar (iCloud)?' });
    expect(within(confirm).getByText(/removed from iCloud/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Apple Calendar disconnected'));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/team/me/calendar/apple')).toBe(true);
    expect(await screen.findByRole('button', { name: 'Connect Apple Calendar (iCloud)' })).toBeInTheDocument();
  });

  it('shows a calendar that needs connecting again, and when Google is not set up', async () => {
    state = {
      ...state,
      google: { available: false, connected: false, needsReconnect: false, email: null, lastSyncAt: null },
      apple: { connected: true, needsReconnect: true, appleId: 'al•••@icloud.com', lastSyncAt: null },
    };
    renderSync();
    expect(await screen.findByText('Needs reconnecting')).toBeInTheDocument();
    const apple = row('Apple Calendar (iCloud)');
    expect(within(apple).getByText('iCloud stopped accepting the app-specific password. Connect again with a new one.')).toBeInTheDocument();
    expect(within(apple).getByRole('button', { name: 'Connect Apple Calendar (iCloud) again' })).toBeInTheDocument();
    expect(within(apple).queryByRole('button', { name: /^Sync/ })).toBeNull();

    const google = row('Google Calendar');
    expect(within(google).getByText("Not available yet: Google sign-in isn't set up for the studio")).toBeInTheDocument();
    expect(within(google).getByRole('button', { name: 'Connect Google Calendar' })).toBeDisabled();
  });
});
