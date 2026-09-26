import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/app/auth';
import { STORAGE_KEYS } from '@/lib/storage';
import admin from '@/locales/en/admin.json';
import common from '@/locales/en/common.json';
import loyalty from '@/locales/en/loyalty.json';
import promo from '@/locales/en/promo.json';
import { AdminLayout } from './AdminLayout';

/*
 * Staff choose their language inside the staff app: the sidebar on computers, the "More" menu
 * on phones. The same page opens in the new language, and the choice is saved to the account.
 */

// The new-booking chime polls the schedule; it plays no part in the menus.
vi.mock('../components/BookingAlerts', () => ({ BookingAlerts: () => null }));
// The "New requests" sheet has tests of its own (requests/PendingRequestsSheet.test.tsx).
vi.mock('../requests/PendingRequestsSheet', () => ({ PendingRequestsSheet: () => null }));

const master = {
  id: 'u-master',
  email: 'irina@example.com',
  name: 'Irina',
  surname: 'Ceban',
  phone: null,
  role: 'admin',
  locale: 'en',
  hasPassword: true,
  hasGoogle: false,
  bookingBlocked: false,
  isDemo: false,
  createdAt: '2026-01-01T09:00:00.000Z',
};

/** The page on screen, so a test can see where switching language went. */
function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

function renderStaffApp(url: string) {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['admin', 'common', 'loyalty', 'promo'],
    defaultNS: 'common',
    resources: { en: { admin, common, loyalty, promo } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['me'], master);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              {['/admin', '/ru/admin', '/en/admin'].map((base) => (
                <Route key={base} path={base} element={<AdminLayout />}>
                  <Route path="calendar" element={<Where />} />
                </Route>
              ))}
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const saved: Array<{ path: string; body: unknown }> = [];
/** Requests waiting for this person's answer. */
let waiting = 0;

beforeEach(() => {
  saved.length = 0;
  waiting = 0;
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (path === '/api/me' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { locale: string };
        saved.push({ path, body });
        return json({ user: { ...master, ...body } });
      }
      // A receptionist: no master profile of their own.
      if (path === '/api/admin/team/me')
        return json({ error: { code: 'NOT_FOUND', message: 'No master profile' } }, 404);
      if (path === '/api/admin/appointments/pending')
        return json({ appointments: [], total: waiting, scope: 'all' });
      throw new Error(`Unmocked request: ${init?.method ?? 'GET'} ${path}`);
    }),
  );
  // The menu sheet checks for reduced motion when it closes.
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

describe('staff language', () => {
  it('computers: the sidebar opens the same page in Romanian and saves it to the account', async () => {
    renderStaffApp('/en/admin/calendar?view=week');
    const sidebar = screen.getByRole('complementary');
    const languages = within(sidebar).getByRole('group', { name: 'Choose language' });
    expect(within(languages).getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(within(languages).getByRole('button', { name: 'Română' }));

    // Romanian has no prefix; the rest of the address (page and query) stays.
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/calendar\?view=week$/);
    await waitFor(() => expect(saved).toEqual([{ path: '/api/me', body: { locale: 'ro' } }]));
    expect(window.localStorage.getItem(STORAGE_KEYS.locale)).toBe('ro');
  });

  it('phones: the "More" menu has the same choice, and it works from the keyboard', async () => {
    const user = userEvent.setup();
    renderStaffApp('/en/admin/calendar');
    await user.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('dialog', { name: 'More' });
    expect(within(menu).getByText('Language')).toBeInTheDocument();

    within(menu).getByRole('button', { name: 'Русский' }).focus();
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('where')).toHaveTextContent(/^\/ru\/admin\/calendar$/);
    await waitFor(() => expect(saved).toEqual([{ path: '/api/me', body: { locale: 'ru' } }]));
    expect(window.localStorage.getItem(STORAGE_KEYS.locale)).toBe('ru');
  });
});

describe('requests waiting', () => {
  const badge = { setAppBadge: vi.fn(() => Promise.resolve()), clearAppBadge: vi.fn(() => Promise.resolve()) };
  beforeEach(() => {
    badge.setAppBadge.mockClear();
    badge.clearAppBadge.mockClear();
    for (const [name, value] of Object.entries(badge)) Object.defineProperty(navigator, name, { configurable: true, value });
  });
  afterEach(() => {
    for (const name of Object.keys(badge)) Reflect.deleteProperty(navigator, name);
  });

  it('"Today" says how many, in the sidebar and the phone bar, and so does the app icon', async () => {
    waiting = 3;
    const view = renderStaffApp('/en/admin/calendar');
    const today = await screen.findAllByRole('link', { name: /^Today\s*3 new requests$/ });
    expect(today).toHaveLength(2);
    for (const link of today) expect(link).toHaveTextContent(/^Today\s*3/);
    expect(badge.setAppBadge).toHaveBeenCalledWith(3);

    // Leaving the staff app (signing out, the client app): the icon is clean again.
    view.unmount();
    expect(badge.clearAppBadge).toHaveBeenCalled();
  });

  it('shows nothing when none wait', async () => {
    renderStaffApp('/en/admin/calendar');
    await waitFor(() => expect(badge.clearAppBadge).toHaveBeenCalled());
    expect(screen.getAllByRole('link', { name: 'Today' })).toHaveLength(2);
    expect(badge.setAppBadge).not.toHaveBeenCalled();
  });
});
