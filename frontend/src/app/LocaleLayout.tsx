import { Suspense, use, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ConsentBanner } from '@/components/common/ConsentBanner';
import { DelayedSpinner } from '@/components/common/DelayedSpinner';
import { SplashDone } from '@/components/common/SplashDone';
import { UpdatePrompt } from '@/components/common/UpdatePrompt';
import { i18n } from '@/i18n';
import type { Locale } from '@/i18n/config';
import { storage, STORAGE_KEYS } from '@/lib/storage';

const ready = new Map<Locale, Promise<unknown>>();
/** One cached promise per language, so rendering can suspend until its strings are loaded. */
function languageReady(locale: Locale): Promise<unknown> {
  let promise = ready.get(locale);
  if (!promise) {
    promise = i18n.language === locale && i18n.hasLoadedNamespace('common')
      ? Promise.resolve()
      : i18n.changeLanguage(locale);
    ready.set(locale, promise);
  }
  return promise;
}

function LocaleContent({ locale }: { locale: Locale }) {
  use(languageReady(locale));
  const { pathname } = useLocation();

  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
    // The bare "/" only decides the language; any other page means the visitor chose it.
    if (pathname !== '/') storage.set(STORAGE_KEYS.locale, locale);
  }, [locale, pathname]);

  return (
    <>
      <Outlet />
      <SplashDone />
      <ConsentBanner />
      <UpdatePrompt />
    </>
  );
}

export function LocaleLayout({ locale }: { locale: Locale }) {
  return (
    <Suspense fallback={<DelayedSpinner />}>
      <LocaleContent locale={locale} />
    </Suspense>
  );
}
