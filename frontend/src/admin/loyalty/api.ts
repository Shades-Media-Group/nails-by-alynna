import { queryOptions } from '@tanstack/react-query';
import { api } from '@/services/api/client';
import type { LoyaltyStatus, StaffAppointment } from '@/types/api';

/** A client's loyalty card as staff see it (scan page, client profile). */
export interface ClientLoyaltyCard {
  client: {
    id: string;
    name: string;
    surname: string;
    phone: string | null;
    email: string | null;
    hasAccount: boolean;
    memberCode: string;
  };
  loyalty: LoyaltyStatus;
  /** Visits to come (pending/confirmed), with the stamp and discount each is expected to earn. */
  appointments: StaffAppointment[];
}

export const adminLoyaltyApi = {
  card: (code: string) => api.get<ClientLoyaltyCard>(`/admin/loyalty/card/${encodeURIComponent(code)}`),
  client: (id: string) => api.get<ClientLoyaltyCard>(`/admin/loyalty/clients/${id}`),
  stamp: (id: string, delta: 1 | -1, reason: string) =>
    api.post<ClientLoyaltyCard>(`/admin/loyalty/clients/${id}/stamps`, { delta, reason }),
};

export const adminLoyaltyQueries = {
  card: (code: string) =>
    queryOptions({ queryKey: ['admin', 'loyalty', 'card', code], queryFn: () => adminLoyaltyApi.card(code), retry: false }),
  client: (id: string) => queryOptions({ queryKey: ['admin', 'loyalty', 'client', id], queryFn: () => adminLoyaltyApi.client(id) }),
};
