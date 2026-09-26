import { useQuery } from '@tanstack/react-query';
import { promoQueries } from '@/services/api/promo';
import type { PromoQuote } from '@/types/api';

export interface PromoState {
  /** The code applied (as typed), or null. */
  code: string | null;
  /** What it takes off this visit, once checked. */
  quote: PromoQuote | null;
  /** Why it doesn't apply (422 PROMO_INVALID), or another error. */
  error: unknown;
  checking: boolean;
  recheck: () => void;
}

/**
 * A promo code checked live against the visit being booked or moved: it is checked again
 * whenever the services, the master or the time change, so the discount shown always fits.
 */
export function usePromoQuote(params: {
  code: string | null;
  serviceIds: string[];
  staffId: string | null;
  start: string | null;
  exclude?: string | null;
}): PromoState {
  const enabled = Boolean(params.code && params.start && params.serviceIds.length > 0);
  const query = useQuery({
    ...promoQueries.check({
      code: params.code ?? '',
      serviceIds: params.serviceIds,
      staffId: params.staffId,
      start: params.start ?? '',
      exclude: params.exclude ?? null,
    }),
    enabled,
  });
  return {
    code: params.code,
    quote: enabled && query.isSuccess ? query.data : null,
    error: enabled && query.isError ? query.error : null,
    checking: enabled && query.isFetching,
    recheck: () => void query.refetch(),
  };
}
