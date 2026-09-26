import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';

/** Lets TanStack Query deliver an update (it notifies observers on a zero-delay timer). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import booking from '@/locales/en/booking.json';
import type { Appointment } from '@/types/api';
import { BookingStatusToasts } from './BookingStatusToasts';

const shown = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui', () => ({ toast: { success: shown } }));
vi.mock('@/hooks/useStudio', () => ({ useStudio: () => ({ timeZone: 'Europe/Chisinau' }) }));

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({ lng: 'en', ns: ['booking'], defaultNS: 'booking', resources: { en: { booking } }, initAsync: false });

const visit = (status: Appointment['status'], start = '2026-09-28T09:00:00.000Z') =>
  ({ id: 'a1', status, start, staff: { id: 's1', name: 'Alina' } }) as unknown as Appointment;

function mount(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/en/home']}>
          <BookingStatusToasts />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => shown.mockReset());

describe('<BookingStatusToasts>', () => {
  it('says nothing on opening, then shows the confirmation and the new time as they happen', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchInterval: false } } });
    client.setQueryData(['appointments', 'upcoming'], [visit('pending')]);
    mount(client);
    await settle();
    expect(shown).not.toHaveBeenCalled();

    client.setQueryData(['appointments', 'upcoming'], [visit('confirmed')]);
    await settle();
    expect(shown).toHaveBeenCalledWith('Your visit is confirmed', expect.objectContaining({ description: expect.stringContaining('with Alina') }));

    client.setQueryData(['appointments', 'upcoming'], [visit('confirmed', '2026-09-29T09:00:00.000Z')]);
    await settle();
    expect(shown).toHaveBeenLastCalledWith('Your visit has a new time', expect.anything());
    expect(shown).toHaveBeenCalledTimes(2);
  });
});
