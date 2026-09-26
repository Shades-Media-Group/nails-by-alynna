import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';

/** Lets TanStack Query deliver an update (it notifies observers on a zero-delay timer). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import admin from '@/locales/en/admin.json';
import type { StaffAppointment } from '@/types/api';
import { adminQueries } from '../api';
import { BookingAlerts } from './BookingAlerts';

const m = vi.hoisted(() => ({ toast: vi.fn(), chime: vi.fn(), push: 'off' }));
vi.mock('@/components/ui', () => ({ toast: m.toast }));
vi.mock('@/lib/chime', () => ({ listenForTaps: () => () => undefined, playChime: m.chime }));
vi.mock('@/lib/push', () => ({ readPushState: () => Promise.resolve(m.push) }));
vi.mock('@/app/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useStudio', () => ({ useI18nText: () => (text: { en: string }) => text.en }));
vi.mock('./hooks', () => ({ useStudioToday: () => ({ today: '2026-09-26', now: 0, timeZone: 'Europe/Chisinau' }) }));

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({ lng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } }, initAsync: false });

const key = adminQueries.appointments({ from: '2026-09-26', to: '2026-11-25' }).queryKey;
const booking = (id: string, status: StaffAppointment['status'], source: StaffAppointment['source'] = 'client') =>
  ({
    id,
    status,
    source,
    start: '2026-09-28T09:00:00.000Z',
    client: { name: 'Ana', surname: 'Rusu' },
    services: [{ name: { en: 'Gel polish' } }],
  }) as unknown as StaffAppointment;

async function mount(client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/en/admin']}>
          <BookingAlerts />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  await act(async () => undefined); // the push state is read after mount
}

beforeEach(() => {
  m.toast.mockReset();
  m.chime.mockReset();
  m.push = 'off';
});

describe('<BookingAlerts>', () => {
  it('chimes and shows a banner only for client bookings that arrive while the app is open', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchInterval: false } } });
    client.setQueryData(key, [booking('old', 'pending')]);
    await mount(client);
    expect(m.toast).not.toHaveBeenCalled();

    client.setQueryData(key, [booking('old', 'pending'), booking('new', 'pending'), booking('desk', 'confirmed', 'staff')]);
    await settle();
    expect(m.chime).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledWith(
      'New booking request',
      expect.objectContaining({ description: expect.stringMatching(/^Ana Rusu · .+ · Gel polish$/) }),
    );
  });

  it('stays quiet where notifications are on (the phone plays its own sound) but still shows the banner', async () => {
    m.push = 'on';
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchInterval: false } } });
    client.setQueryData(key, []);
    await mount(client);
    client.setQueryData(key, [booking('new', 'confirmed')]);
    await settle();
    expect(m.chime).not.toHaveBeenCalled();
    expect(m.toast).toHaveBeenCalledWith('New booking', expect.anything());
  });
});
