import { QueryClient, queryOptions } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { appointmentsApi, publicApi } from './api/endpoints';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status > 0 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/**
 * For data the studio can change while it is on someone's screen (a booking confirmed, moved or
 * cancelled at the desk, a stamp added): fetched again whenever the app comes back to the
 * foreground, and every 30 s while it stays there. TanStack pauses the timer while the app is
 * hidden, and a push makes it refresh at once (lib/liveUpdates.ts).
 */
export const LIVE = { refetchOnWindowFocus: 'always', refetchInterval: 30_000 } as const;

/**
 * The studio's own data (settings, price list, team): it changes rarely, but an edit at the desk
 * shows the next time the app comes back to the foreground (the server lets browsers keep it
 * for 60 s, so a quick return costs no request).
 */
const STUDIO = { staleTime: 5 * 60_000, refetchOnWindowFocus: 'always' } as const;

/** Query keys and fetchers in one place (TanStack Query v5 queryOptions). */
export const queries = {
  config: () => queryOptions({ queryKey: ['config'], queryFn: publicApi.config, ...STUDIO }),
  catalog: () => queryOptions({ queryKey: ['catalog'], queryFn: publicApi.catalog, ...STUDIO }),
  staff: () => queryOptions({ queryKey: ['staff'], queryFn: publicApi.staff, ...STUDIO }),
  appointments: (scope: 'upcoming' | 'past') =>
    queryOptions({ queryKey: ['appointments', scope], queryFn: () => appointmentsApi.list(scope), ...LIVE }),
  appointment: (id: string) => queryOptions({ queryKey: ['appointment', id], queryFn: () => appointmentsApi.get(id), ...LIVE }),
};
