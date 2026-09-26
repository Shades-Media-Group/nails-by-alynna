import { queryOptions } from '@tanstack/react-query';
import { LIVE } from '@/services/queries';
import type { LoyaltyCard } from '@/types/api';
import { api } from './client';

export const loyaltyApi = {
  /** The signed-in client's card: member code (for the QR) and stamps. */
  mine: () => api.get<LoyaltyCard>('/loyalty'),
};

export const loyaltyQueries = {
  mine: () => queryOptions({ queryKey: ['loyalty'], queryFn: loyaltyApi.mine, ...LIVE }),
};
