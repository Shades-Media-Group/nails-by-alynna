import i18n, { type BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, type Locale, type Namespace } from './config';

/**
 * Translations are JSON files in src/locales/<lang>/<namespace>.json, loaded on demand.
 * Vite fingerprints each file, so every deploy ships updated translations and the service
 * worker picks them up (admin.json is only ever fetched inside the dashboard).
 */
const loaders = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*/*.json');

const lazyJsonBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = loaders[`../locales/${language}/${namespace}.json`];
    if (!load) {
      callback(null, {});
      return;
    }
    load().then(
      (module) => callback(null, module.default),
      (error: unknown) => callback(error as Error, null),
    );
  },
};

export function initI18n(locale: Locale): Promise<unknown> {
  return i18n
    .use(lazyJsonBackend)
    .use(initReactI18next)
    .init({
      lng: locale,
      fallbackLng: DEFAULT_LOCALE === 'ro' ? ['en', 'ro'] : 'en',
      supportedLngs: [...LOCALES],
      ns: ['common'] satisfies Namespace[],
      defaultNS: 'common',
      load: 'languageOnly',
      interpolation: { escapeValue: false },
      returnNull: false,
      react: { useSuspense: true, bindI18n: 'languageChanged loaded' },
    });
}

export { i18n };
