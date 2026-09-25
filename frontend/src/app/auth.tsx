import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ApiError, hasSessionHint, onSessionExpired } from '@/services/api/client';
import { authApi } from '@/services/api/endpoints';
import type { Role, User } from '@/types/api';

/**
 * Session state. Tokens live in httpOnly cookies, so the client only knows "who am I" —
 * fetched once (skipped entirely when no session cookie hint exists) and cached.
 */

export const ME_KEY = ['me'] as const;

async function fetchMe(): Promise<User | null> {
  if (!hasSessionHint()) return null;
  try {
    return await authApi.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

interface AuthContextValue {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  isStaff: boolean;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const STAFF_ROLES: Role[] = ['admin', 'administrator'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 5 * 60_000, retry: 1 });

  const setUser = useCallback((user: User | null) => queryClient.setQueryData(ME_KEY, user), [queryClient]);

  useEffect(
    () =>
      onSessionExpired(() => {
        queryClient.setQueryData(ME_KEY, null);
      }),
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Drop every cached private response before anything else renders.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'config' && q.queryKey[0] !== 'catalog' });
      queryClient.setQueryData(ME_KEY, null);
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const user = me.data ?? null;
    const status: AuthContextValue['status'] = me.isPending
      ? 'loading'
      : me.isError
        ? 'error'
        : user
          ? 'authenticated'
          : 'anonymous';
    return {
      user,
      status,
      isStaff: Boolean(user && STAFF_ROLES.includes(user.role)),
      setUser,
      logout,
      retry: () => void me.refetch(),
    };
  }, [me, setUser, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where a signed-in user lands: staff on the dashboard, clients on their home. */
export function homePathFor(user: Pick<User, 'role'> | null): string {
  if (!user) return '/login';
  return STAFF_ROLES.includes(user.role) ? '/admin' : '/home';
}
