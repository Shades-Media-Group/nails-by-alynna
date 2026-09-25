import { Suspense, useEffect } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router';
import { ConsentBanner } from '@/components/common/ConsentBanner';
import { DelayedSpinner } from '@/components/common/DelayedSpinner';
import { NavigationProgress } from '@/components/common/NavigationProgress';
import { SplashDone } from '@/components/common/SplashDone';
import { UpdatePrompt } from '@/components/common/UpdatePrompt';
import { i18n } from '@/i18n';
import type { Locale } from '@/i18n/config';
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
      <SplashDone />
      <ConsentBanner />
      <UpdatePrompt />
    </Suspense>
  );
}
