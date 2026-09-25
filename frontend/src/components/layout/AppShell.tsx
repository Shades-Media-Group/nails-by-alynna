import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { TabBar } from './TabBar';
import { TopNav } from './TopNav';

/** Client app frame: desktop top nav, phone floating tab bar, one scroll container. */
export function AppShell() {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();

  // New screen → start at the top (the tab bar keeps its own position).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="min-h-dvh bg-white">
      <a
        href="#main"
        className="sr-only z-50 rounded-pill bg-ink-900 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t('a11y.skipToContent')}
      </a>
      <TopNav />
      <main id="main" className="mx-auto w-full max-w-6xl pb-[calc(var(--safe-bottom)+7rem)] lg:px-8 lg:pb-16">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
