import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { DemoRibbon } from '@/components/common/DemoRibbon';
import { TabBar } from './TabBar';
import { TopNav } from './TopNav';

/** Client app frame: desktop top nav, phone floating tab bar, one scroll container. */
export function AppShell() {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();

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
      <main id="main" className="mx-auto w-full max-w-6xl pb-[calc(var(--safe-bottom)+6.5rem)] lg:px-8 lg:pb-16">
        {/* Each screen fades in; keyed so a new route never inherits the old one's state. */}
        <div key={pathname} className="animate-page">
          <Outlet />
        </div>
      </main>
      <TabBar />
    </div>
  );
}
