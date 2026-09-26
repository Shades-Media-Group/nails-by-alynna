import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useMatches, useSearchParams } from 'react-router';
import { safeNextPath, signedInPath } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import { needsLanding, signedOutStart } from '@/lib/platform';
import type { Role } from '@/types/api';
import { homePathFor, useAuth } from './auth';

/** A route's `handle`: `comeBack` pages are where a signed-out visitor returns after signing in. */
export interface RouteHandle {
  comeBack?: boolean;
}

/** Signed-in only. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { user, signedOut } = useAuth();
  const { lp } = useLocale();
  const { pathname, search } = useLocation();
  const matches = useMatches();
  if (!user) {
    // A page opened from an email link (the feedback form) is where signing in leads back to
    // (not after signing out on purpose)...
    const comeBack =
      !signedOut && matches.some((match) => (match.handle as RouteHandle | undefined)?.comeBack);
    const next = comeBack ? safeNextPath(`${pathname}${search}`) : null;
    if (next) return <Navigate to={`${lp('/login')}?next=${encodeURIComponent(next)}`} replace />;
    // ...otherwise signing in always starts on Home (the studio's choice), whichever page was
    // open; phones in the browser see the web-or-app choice first.
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
 * Login/sign-up screens: signed-in visitors go straight to their destination, in their account's
 * language (this also runs the moment a sign-in succeeds). A phone browser that lands here first
 * (a shared link, or "open in Safari" from Telegram) is offered "web or app" once; studio invites
 * skip it, since they already are the way in, and so do links that lead back to a page (the
 * feedback email), which the choice would lose.
 */
export function GuestOnly() {
  const { user } = useAuth();
  const { lp } = useLocale();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  if (user) return <Navigate to={signedInPath(next ?? homePathFor(user), user.locale)} replace />;
  if (needsLanding() && !params.get('invite') && !next) return <Navigate to={lp('/')} replace />;
  return <Outlet />;
}
