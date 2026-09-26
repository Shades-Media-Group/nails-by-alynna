export const LOCALES = ['ro', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Romanian lives at unprefixed URLs (/login); others are prefixed (/ru/login, /en/login). */
export const DEFAULT_LOCALE: Locale = 'ro';
/** First visit with no saved language and a browser language we don't speak → English. */
export const FALLBACK_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = { ro: 'Română', ru: 'Русский', en: 'English' };
export const LOCALE_SHORT: Record<Locale, string> = { ro: 'RO', ru: 'RU', en: 'EN' };
/** BCP 47 tags for Intl formatting (Moldovan conventions). */
export const LOCALE_TAGS: Record<Locale, string> = { ro: 'ro-MD', ru: 'ru-MD', en: 'en-GB' };

export const NAMESPACES = ['common', 'auth', 'booking', 'account', 'install', 'legal', 'admin', 'loyalty', 'onboarding', 'promo'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
