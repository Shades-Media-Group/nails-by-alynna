import { useQuery } from '@tanstack/react-query';
import type { PromoState } from '@/components/promo/usePromoQuote';
import { adminPromoQueries } from './api';

/**
 * A code the client brings to the desk, checked live against the booking being made: its services,
 * master and time, and the client (none yet for someone added on the spot).
 */
export function useDeskPromoQuote(params: {
  code: string | null;
  serviceIds: string[];
  staffId: string | null;
  start: string | null;
  clientId: string | null;
}): PromoState {
  const enabled = Boolean(params.code && params.start && params.serviceIds.length > 0);
  const query = useQuery({
    ...adminPromoQueries.check({
      code: params.code ?? '',
      serviceIds: params.serviceIds,
      staffId: params.staffId,
      start: params.start ?? '',
      clientId: params.clientId,
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
