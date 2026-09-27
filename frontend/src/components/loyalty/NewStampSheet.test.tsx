import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import common from '@/locales/en/common.json';
import loyalty from '@/locales/en/loyalty.json';
import { saveSeenVisits } from '@/lib/stampsSeen';
import type { LoyaltyCard } from '@/types/api';
import { NewStampSheet } from './NewStampSheet';

/** Lets TanStack Query deliver an update (it notifies observers on a zero-delay timer). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

vi.mock('@/app/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'client', isDemo: false } }),
}));

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en',
  ns: ['loyalty', 'common'],
  defaultNS: 'loyalty',
  resources: { en: { loyalty, common } },
  initAsync: false,
});

const card = (visits: number): LoyaltyCard => ({
  card: { code: 'K7QM2XRP', url: 'https://example.com/c/K7QM2XRP' },
  loyalty: {
    enabled: true,
    cycle: 8,
    rewards: [{ visit: 4, percent: 15 }],
    visits,
    stamps: visits % 8,
    card: Math.floor(visits / 8) + 1,
    nextReward: visits % 8 < 3 ? { visit: 4, percent: 15, inVisits: 4 - (visits % 8) - 1 } : null,
    history: [],
  },
});

function mount(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/en/home']}>
          <NewStampSheet />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchInterval: false } } });
const sheet = () =>
  screen.queryByRole('dialog', { name: 'A new stamp!' }) as HTMLDialogElement | null;

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

describe('<NewStampSheet>', () => {
  it('stays quiet the first time on a device, then shows a stamp added at the desk, once', async () => {
    const client = newClient();
    client.setQueryData(['loyalty'], card(1));
    mount(client);
    await settle();
    expect(sheet()).toBeNull();

    client.setQueryData(['loyalty'], card(2));
    await settle();
    expect(sheet()).not.toBeNull();
    expect(screen.getByText('2 of 8 visits')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the card' })).toHaveAttribute(
      'href',
      '/en/loyalty',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(sheet()?.open ?? false).toBe(false));
    client.setQueryData(['loyalty'], { ...card(2) });
    await settle();
    expect(sheet()?.open ?? false).toBe(false);
  });

  it('shows stamps added while the app was closed on the next opening', async () => {
    saveSeenVisits('u1', 1);
    const client = newClient();
    client.setQueryData(['loyalty'], card(3));
    mount(client);
    await settle();
    expect(screen.getByRole('dialog', { name: '2 new stamps!' })).toBeInTheDocument();
  });
});
