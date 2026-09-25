import type { ReactNode } from 'react';
import { Navigate, Outlet, useSearchParams } from 'react-router';
import { safeNextPath } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import { needsLanding, signedOutStart } from '@/lib/platform';
import type { Role } from '@/types/api';
import { homePathFor, useAuth } from './auth';

/** Signed-in only. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const { lp } = useLocale();
  if (!user) {
    // Signing in always starts on Home (the studio's choice), whichever page was open; phones in
    // the browser see the web-or-app choice first.
    return <Navigate to={lp(signedOutStart())} replace />;
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

/**
 * Login/sign-up screens: signed-in visitors go straight to their destination. A phone browser
 * that lands here first (a shared link, or "open in Safari" from Telegram) is offered "web or
 * app" once; studio invites skip it, since they already are the way in.
 */
export function GuestOnly() {
  const { user } = useAuth();
  const { lp } = useLocale();
  const [params] = useSearchParams();
  if (user) {
    const next = safeNextPath(params.get('next'));
    return <Navigate to={lp(next ?? homePathFor(user))} replace />;
  }
  if (needsLanding() && !params.get('invite')) return <Navigate to={lp('/')} replace />;
  return <Outlet />;
}
