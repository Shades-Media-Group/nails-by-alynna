import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, useLocation, type RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { RouteError } from '@/components/common/RouteError';
import { LOCALES, type Locale } from '@/i18n/config';
import { canonicalDefaultPath } from '@/i18n/routing';
import { GuestOnly, RequireAuth, RequireRole } from './guards';
import { LocaleLayout, localeLoader } from './LocaleLayout';

/** Route modules are code-split; each page downloads only when first visited. */
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await load()).default });

/** /ro/... is served canonically without the prefix. */
function StripDefaultLocale() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={canonicalDefaultPath(pathname, search, hash) ?? '/'} replace />;
}

/**
 * Staff dashboard. Everything under src/admin is only reachable through these dynamic
 * imports, so clients never download it and the installed app never precaches it.
 */
const adminRoutes: RouteObject = {
  path: 'admin',
  element: <RequireRole roles={['admin', 'administrator']} />,
  children: [
    {
      lazy: async () => ({ Component: (await import('@/admin/layout/AdminLayout')).AdminLayout }),
      children: [
        { index: true, lazy: page(() => import('@/admin/pages/DashboardPage')) },
        { path: 'calendar', lazy: page(() => import('@/admin/pages/CalendarPage')) },
        { path: 'appointments/new', lazy: page(() => import('@/admin/pages/NewAppointmentPage')) },
        { path: 'appointments/:id', lazy: page(() => import('@/admin/pages/AppointmentPage')) },
        { path: 'clients', lazy: page(() => import('@/admin/pages/ClientsPage')) },
        { path: 'clients/:id', lazy: page(() => import('@/admin/pages/ClientPage')) },
        { path: 'services', lazy: page(() => import('@/admin/pages/ServicesPage')) },
        { path: 'team', lazy: page(() => import('@/admin/pages/TeamPage')) },
        { path: 'schedule', lazy: page(() => import('@/admin/pages/MySchedulePage')) },
        { path: 'settings', lazy: page(() => import('@/admin/pages/SettingsPage')) },
        { path: 'scan', lazy: page(() => import('@/admin/pages/ScanPage')) },
        { path: 'promo', lazy: page(() => import('@/admin/pages/PromoCodesPage')) },
        {
          element: <RequireRole roles={['administrator']} />,
          children: [
            { path: 'users', lazy: page(() => import('@/admin/pages/UsersPage')) },
            { path: 'audit', lazy: page(() => import('@/admin/pages/AuditPage')) },
          ],
        },
      ],
    },
  ],
};

function localeTree(locale: Locale): RouteObject {
  return {
    path: locale === 'ro' ? '/' : `/${locale}`,
    element: <LocaleLayout locale={locale} />,
    loader: () => localeLoader(locale),
    // The static splash covers the first load; nothing to render meanwhile.
    HydrateFallback: () => null,
    // Only a language change needs the loader again.
    shouldRevalidate: ({ currentUrl, nextUrl }) => currentUrl.pathname.split('/')[1] !== nextUrl.pathname.split('/')[1],
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: page(() => import('@/pages/landing/LandingPage')) },
      {
        element: <GuestOnly />,
        children: [
          { path: 'login', lazy: page(() => import('@/pages/auth/WelcomePage')) },
          { path: 'login/email', lazy: page(() => import('@/pages/auth/LoginPage')) },
          { path: 'signup', lazy: page(() => import('@/pages/auth/SignupPage')) },
          { path: 'forgot-password', lazy: page(() => import('@/pages/auth/ForgotPasswordPage')) },
        ],
      },
      { path: 'reset-password', lazy: page(() => import('@/pages/auth/ResetPasswordPage')) },
      { path: 'app', lazy: page(() => import('@/pages/install/InstallPage')) },
      { path: 'privacy', lazy: page(() => import('@/pages/legal/PrivacyPage')) },
      { path: 'terms', lazy: page(() => import('@/pages/legal/TermsPage')) },
      // Where the loyalty-card QR points (staff scanning with the phone camera land on the card).
      { path: 'c/:code', lazy: page(() => import('@/pages/loyalty/CardLinkPage')) },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: 'home', lazy: page(() => import('@/pages/home/HomePage')) },
              { path: 'services', lazy: page(() => import('@/pages/services/ServicesPage')) },
              { path: 'bookings', lazy: page(() => import('@/pages/appointments/AppointmentsPage')) },
              { path: 'bookings/:id', lazy: page(() => import('@/pages/appointments/AppointmentDetailPage')) },
              { path: 'profile', lazy: page(() => import('@/pages/profile/ProfilePage')) },
              { path: 'profile/notifications', lazy: page(() => import('@/pages/profile/NotificationsPage')) },
              { path: 'studio', lazy: page(() => import('@/pages/studio/StudioPage')) },
              { path: 'loyalty', lazy: page(() => import('@/pages/loyalty/LoyaltyPage')) },
            ],
          },
          { path: 'book', lazy: page(() => import('@/pages/booking/BookingPage')) },
          {
            path: 'design-system',
            element: <RequireRole roles={['administrator']} />,
            children: [{ index: true, lazy: page(() => import('@/pages/design-system/DesignSystemPage')) }],
          },
        ],
      },
      adminRoutes,
      { path: '*', lazy: page(() => import('@/pages/NotFoundPage')) },
    ],
  };
}

const routes: RouteObject[] = [
  { path: '/ro/*', element: <StripDefaultLocale /> },
  { path: '/ro', element: <StripDefaultLocale /> },
  ...LOCALES.filter((l) => l !== 'ro').map(localeTree),
  localeTree('ro'),
];

let router: ReturnType<typeof createBrowserRouter> | null = null;

/** Created on first use — after i18next is initialised, because route loaders use it. */
export function getRouter() {
  router ??= createBrowserRouter(routes);
  return router;
}
