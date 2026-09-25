import { Suspense, useEffect } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router';
import { ConsentBanner } from '@/components/common/ConsentBanner';
import { DelayedSpinner } from '@/components/common/DelayedSpinner';
import { NavigationProgress } from '@/components/common/NavigationProgress';
import { PageScrollbar } from '@/components/common/PageScrollbar';
import { SplashDone } from '@/components/common/SplashDone';
import { UpdatePrompt } from '@/components/common/UpdatePrompt';
import { i18n } from '@/i18n';
import type { Locale } from '@/i18n/config';
import { closeKeyboard } from '@/lib/platform';
import { storage, STORAGE_KEYS } from '@/lib/storage';

/**
 * Route loader for each language tree: switches i18next *before* React renders the route,
 * so no component ever re-renders another during render.
 */
export async function localeLoader(locale: Locale): Promise<null> {
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
  return null;
}

export function LocaleLayout({ locale }: { locale: Locale }) {
  const { pathname } = useLocation();

  // iOS swipe-back (Safari and the Home Screen app) already animates the page change; our own
  // fade on top of it would play the transition twice.
  useEffect(() => {
    const root = document.documentElement;
    let timer: number | undefined;
    const onPop = (event: PopStateEvent) => {
      if (!(event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) return;
      root.dataset.uaTransition = '';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => delete root.dataset.uaTransition, 700);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.clearTimeout(timer);
    };
  }, []);

  // Sending a form closes the iPhone keyboard at once: a form that moves on (sign-in, sign-up,
  // booking) would otherwise leave the keyboard's scroll offset on the next page, shifted up
  // under the status bar.
  useEffect(() => {
    document.addEventListener('submit', closeKeyboard, true);
    return () => document.removeEventListener('submit', closeKeyboard, true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    // The bare "/" only decides the language; any other page means the visitor chose it.
    if (pathname !== '/') storage.set(STORAGE_KEYS.locale, locale);
  }, [locale, pathname]);

  return (
    <Suspense fallback={<DelayedSpinner />}>
      <NavigationProgress />
      <Outlet />
      {/* A new page opens at the top; Back returns to where you were. */}
      <ScrollRestoration />
      <PageScrollbar />
      <SplashDone />
      <ConsentBanner />
      <UpdatePrompt />
    </Suspense>
  );
}
