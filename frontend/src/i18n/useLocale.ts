import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { isLocale, LOCALE_TAGS, type Locale } from './config';
import { localizePath, switchLocaleUrl } from './routing';

/** Current locale plus helpers to build localized links and switch language. */
export function useLocale() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const locale: Locale = isLocale(i18n.language) ? i18n.language : 'ro';

  const lp = useCallback((path: string) => localizePath(path, locale), [locale]);

  const switchLocale = useCallback(
    (target: Locale) => {
      storage.set(STORAGE_KEYS.locale, target);
      navigate(switchLocaleUrl(location.pathname, location.search, location.hash, target), { replace: true });
    },
    [location, navigate],
  );

  return { locale, tag: LOCALE_TAGS[locale], lp, switchLocale };
}
