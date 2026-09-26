import { queryOptions } from '@tanstack/react-query';
import type { PromoQuote } from '@/types/api';
import { api, query } from './client';

export interface PromoCheckParams {
  code: string;
  serviceIds: string[];
  /** null = any master. */
  staffId: string | null;
  start: string;
  /** The booking being moved: its own code is checked the way a move checks it. */
  exclude?: string | null;
}

export const promoApi = {
  /** What a code takes off this visit; 422 PROMO_INVALID (with the reason) when it doesn't apply. */
  check: (params: PromoCheckParams, signal?: AbortSignal) =>
    api
      .get<{ promo: PromoQuote }>(
        `/promo/check${query({
          code: params.code,
          serviceIds: params.serviceIds.join(','),
          staffId: params.staffId ?? 'any',
          start: params.start,
          exclude: params.exclude,
        })}`,
        { signal },
      )
      .then((r) => r.promo),
};

export const promoQueries = {
  check: (params: PromoCheckParams) =>
    queryOptions({
      queryKey: ['promo-check', params],
      queryFn: ({ signal }) => promoApi.check(params, signal),
      staleTime: 30_000,
      retry: false,
    }),
};
