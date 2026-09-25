import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { replayIntro } from '@/lib/intro';
import { resyncPush } from '@/lib/push';
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
  /** The visitor just signed out on purpose (not an expired session): no "come back to" link. */
  signedOut: boolean;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const STAFF_ROLES: Role[] = ['admin', 'administrator'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 5 * 60_000, retry: 1 });
  const [signedOut, setSignedOut] = useState(false);

  const setUser = useCallback(
    (user: User | null) => {
      if (user) {
        setSignedOut(false);
        // Every new sign-in of the shared demo account shows the intro again.
        if (user.isDemo && !queryClient.getQueryData<User | null>(ME_KEY)) replayIntro(user.id);
      }
      queryClient.setQueryData(ME_KEY, user);
    },
    [queryClient],
  );

  // Signed in on this device again: its notifications (if this person had them on) resume,
  // whichever screen the app opens on.
  const userId = me.data?.id;
  useEffect(() => {
    if (userId) void resyncPush(userId);
  }, [userId]);

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
      // Signed out first, on the live query the app is watching (removing it instead would leave
      // the screen on the old user, and the login page would bounce straight back home)...
      setSignedOut(true);
      queryClient.setQueryData(ME_KEY, null);
      // ...then every other cached private response goes.
      const shared = new Set(['config', 'catalog', ME_KEY[0]]);
      queryClient.removeQueries({ predicate: (q) => !shared.has(String(q.queryKey[0])) });
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
      signedOut,
      setUser,
      logout,
      retry: () => void me.refetch(),
    };
  }, [me, signedOut, setUser, logout]);

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
