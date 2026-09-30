import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import admin from '@/locales/en/admin.json';
import common from '@/locales/en/common.json';
import loyalty from '@/locales/en/loyalty.json';
import SettingsPage from './SettingsPage';

vi.mock('@/app/auth', () => ({
  useAuth: () => ({
    user: { id: 'u-owner', email: 'owner@example.com', name: 'Alina', surname: 'Rusu', role: 'administrator', locale: 'en' },
    status: 'authenticated',
    isStaff: true,
  }),
}));

/** Texts as the API returns them: the database sorts object keys ({ en, ro, ru }). */
const sorted = (en: string, ro: string, ru: string) => ({ en, ro, ru });
const settings = {
  name: 'Nails by Alynna',
  legalName: '',
  legalId: '',
  tagline: sorted('Your nails. Your rules.', 'Unghiile tale. Regulile tale.', 'Твои ногти. Твои правила.'),
  about: sorted('About', 'Despre', 'О нас'),
  policy: sorted('Policy', 'Regulile', 'Правила'),
  address: '',
  city: 'Chișinău',
  mapsUrl: '',
  location: { lat: 47.063205, lng: 28.844794 },
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
  requireApproval: true,
  bufferMin: 0,
  maxActiveBookings: 3,
  smartSlots: true,
  maxGapMin: 10,
  minBookableGapMin: 90,
  loyaltyEnabled: true,
  loyaltyCycle: 8,
  loyaltyRewards: [{ visit: 4, percent: 15 }],
};

const patches: unknown[] = [];

beforeEach(() => {
  patches.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      let body: unknown = { settings };
      if (init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push(patch);
        body = { settings: { ...settings, ...patch } };
      } else if (path === '/api/admin/settings/rebook') {
        body = { defaults: null, placeholders: [], available: { email: true, push: true }, sample: {} };
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['admin', 'common', 'loyalty'],
    defaultNS: 'common',
    resources: { en: { admin, common, loyalty } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/en/admin/settings']}>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('<SettingsPage> saving', () => {
  it('sends nothing for texts that did not change, whatever order the API keeps their languages in', async () => {
    const user = userEvent.setup();
    renderPage();
    const texts = within(await screen.findByRole('region', { name: 'Texts for clients' }));
    // Unchanged: nothing to save.
    expect(texts.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Only the tagline changes, so only the tagline goes out (and becomes the studio's own).
    const tagline = texts.getAllByRole('textbox')[0]!;
    expect(tagline).toHaveValue('Unghiile tale. Regulile tale.');
    await user.type(tagline, '!');
    await user.click(texts.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ tagline: { ro: 'Unghiile tale. Regulile tale.!', ru: 'Твои ногти. Твои правила.', en: 'Your nails. Your rules.' } });
  });
});
