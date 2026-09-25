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

/** Query keys and fetchers in one place (TanStack Query v5 queryOptions). */
export const queries = {
  config: () => queryOptions({ queryKey: ['config'], queryFn: publicApi.config, staleTime: 5 * 60_000 }),
  catalog: () => queryOptions({ queryKey: ['catalog'], queryFn: publicApi.catalog, staleTime: 5 * 60_000 }),
  staff: () => queryOptions({ queryKey: ['staff'], queryFn: publicApi.staff, staleTime: 5 * 60_000 }),
  appointments: (scope: 'upcoming' | 'past') =>
    queryOptions({ queryKey: ['appointments', scope], queryFn: () => appointmentsApi.list(scope) }),
  appointment: (id: string) => queryOptions({ queryKey: ['appointment', id], queryFn: () => appointmentsApi.get(id) }),
};
