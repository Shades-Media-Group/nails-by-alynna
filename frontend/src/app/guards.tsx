import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { safeNextPath, splitLocale } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import type { Role } from '@/types/api';
import { homePathFor, useAuth } from './auth';

/** Signed-in only; remembers where the visitor wanted to go. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { user, signedOut } = useAuth();
  const { lp } = useLocale();
  const location = useLocation();
  if (!user) {
    // After "Log out" the welcome screen starts fresh; an expired session comes back here.
    if (signedOut) return <Navigate to={lp('/login')} replace />;
    const next = encodeURIComponent(splitLocale(location.pathname).rest + location.search);
    return <Navigate to={`${lp('/login')}?next=${next}`} replace />;
  }
  return children ? <>{children}</> : <Outlet />;
}

export function RequireRole({ roles, children }: { roles: Role[]; children?: ReactNode }) {
  const { user } = useAuth();
  const { lp } = useLocale();
  if (!user) return <RequireAuth />;
  if (!roles.includes(user.role)) return <Navigate to={lp(homePathFor(user))} replace />;
  return children ? <>{children}</> : <Outlet />;
}

/** Login/sign-up screens: signed-in visitors go straight to their destination. */
export function GuestOnly() {
  const { user } = useAuth();
  const { lp } = useLocale();
  const [params] = useSearchParams();
  if (user) {
    const next = safeNextPath(params.get('next'));
    return <Navigate to={lp(next ?? homePathFor(user))} replace />;
  }
  return <Outlet />;
}
