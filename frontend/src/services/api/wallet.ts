import { queryOptions } from '@tanstack/react-query';
import { api } from './client';

/** Which Wallet the studio has set up (the other one says "coming soon"). */
export interface WalletStatus {
  apple: boolean;
  google: boolean;
}

export const walletApi = {
  status: () => api.get<WalletStatus>('/wallet'),
  /** A ten-minute link to the client's .pkpass (no cookie needed, for the iPhone's file view). */
  appleLink: () => api.get<{ url: string }>('/wallet/apple/link'),
  /** The "Add to Google Wallet" link. */
  googleLink: () => api.get<{ url: string }>('/wallet/google'),
};

export const walletQueries = {
  status: () => queryOptions({ queryKey: ['wallet'], queryFn: walletApi.status, staleTime: 5 * 60_000 }),
  // Fetched fresh each time the sheet opens, so a tap always has a live link at hand.
  link: (wallet: 'apple' | 'google') =>
    queryOptions({
      queryKey: ['wallet', wallet],
      queryFn: wallet === 'apple' ? walletApi.appleLink : walletApi.googleLink,
      staleTime: 0,
      gcTime: 0,
    }),
};
