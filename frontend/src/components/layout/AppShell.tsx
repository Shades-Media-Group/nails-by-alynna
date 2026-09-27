import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { useAuth } from '@/app/auth';
import { BookingStatusToasts } from '@/components/booking/BookingStatusToasts';
import { VisitConfirmedSheet } from '@/components/booking/VisitConfirmedSheet';
import { NewStampSheet } from '@/components/loyalty/NewStampSheet';
import { DemoRibbon } from '@/components/common/DemoRibbon';
import { PushPrompt } from '@/components/notifications/PushPrompt';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { TabBar } from './TabBar';
import { TopNav } from './TopNav';

/** Client app frame: desktop top nav, phone floating tab bar, one scroll container. */
export function AppShell() {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const { user } = useAuth();

  return (
    <div className="min-h-dvh bg-white">
      <a
        href="#main"
        className="sr-only z-50 rounded-pill bg-ink-900 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t('a11y.skipToContent')}
      </a>
      <DemoRibbon />
      <TopNav />
      <main
        id="main"
        className="mx-auto w-full max-w-6xl pb-[calc(var(--safe-bottom)+6.5rem)] lg:px-8 lg:pb-16"
      >
        {/* Each screen fades in; keyed so a new route never inherits the old one's state. */}
        <div key={pathname} className="animate-page">
          <Outlet />
        </div>
      </main>
      <TabBar />
      {/* A banner when the studio moves a visit while the app is open. */}
      {user ? <BookingStatusToasts /> : null}
      {/* "You're booked!" once the studio confirms a request, now or the next time they look. */}
      {user ? <VisitConfirmedSheet /> : null}
      {/* A new stamp on the loyalty card, pressing in. */}
      {user ? <NewStampSheet /> : null}
      {/* First sign-in: a short intro to the app (clients only). */}
      {user?.role === 'client' ? <Onboarding key={user.id} user={user} /> : null}
      {/* Later, when they're idle on a main page: "Turn on notifications?" (clients only). */}
      <PushPrompt audience="client" />
    </div>
  );
}
