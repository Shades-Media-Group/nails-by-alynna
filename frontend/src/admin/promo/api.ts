import { queryOptions } from '@tanstack/react-query';
import { api, query } from '@/services/api/client';
import type { PromoCheckParams } from '@/services/api/promo';
import type { PromoKind, PromoQuote } from '@/types/api';

/** Shapes of backend/src/modules/promo/routes.ts (staff). */

/** Where a code stands today: switched off, before its first day, past its last, or out of uses. */
export type PromoStatus = 'active' | 'scheduled' | 'expired' | 'used_up' | 'off';

export interface PromoInput {
  code: string;
  kind: PromoKind;
  /** 1–100 for a percentage; whole units of the studio currency for an amount. */
  value: number;
  /** First and last visit day (YYYY-MM-DD, studio time); null = open. */
  startsAt: string | null;
  endsAt: string | null;
  /** null = no limit. */
  maxUses: number | null;
  maxUsesPerClient: number;
  minTotal: number;
  /** null = every service. */
  serviceIds: string[] | null;
  /** The master it belongs to; null = the whole studio. */
  staffId: string | null;
  firstVisitOnly: boolean;
  isActive: boolean;
  note: string;
}

export interface AdminPromo extends PromoInput {
  id: string;
  /** Bookings holding a use now (upcoming ones, and completed visits it discounted). */
  usedCount: number;
  status: PromoStatus;
  /** No booking ever used it (a used code is switched off instead). */
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The owner changes every code; a master only their own; other staff look. */
export interface PromoAccess {
  manage: 'all' | 'own' | 'none';
  /** The signed-in staff member's master profile. */
  masterId: string | null;
}

export const adminPromoApi = {
  list: () => api.get<{ promos: AdminPromo[]; access: PromoAccess }>('/admin/promo'),
  create: (input: PromoInput) => api.post<{ promo: AdminPromo }>('/admin/promo', input).then((r) => r.promo),
  /** Send only what changed. */
  update: (id: string, input: Partial<PromoInput>) => api.patch<{ promo: AdminPromo }>(`/admin/promo/${id}`, input).then((r) => r.promo),
  remove: (id: string) => api.delete<{ ok: true }>(`/admin/promo/${id}`),
  /** A code checked at the desk; without `clientId` it is checked for a new client. */
  check: (params: PromoCheckParams & { clientId?: string | null }, signal?: AbortSignal) =>
    api
      .get<{ promo: PromoQuote }>(
        `/admin/promo/check${query({
          code: params.code,
          serviceIds: params.serviceIds.join(','),
          staffId: params.staffId ?? 'any',
          start: params.start,
          clientId: params.clientId,
        })}`,
        { signal },
      )
      .then((r) => r.promo),
};

export const adminPromoQueries = {
  list: () => queryOptions({ queryKey: ['admin', 'promo'], queryFn: adminPromoApi.list, staleTime: 30_000 }),
  check: (params: PromoCheckParams & { clientId?: string | null }) =>
    queryOptions({
      queryKey: ['admin', 'promo-check', params],
      queryFn: ({ signal }) => adminPromoApi.check(params, signal),
      staleTime: 30_000,
      retry: false,
    }),
};
