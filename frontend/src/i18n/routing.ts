import { DEFAULT_LOCALE, FALLBACK_LOCALE, isLocale, LOCALES, type Locale } from './config';

/**
 * Locale-aware URLs. Pure functions (unit-tested) shared by the router, links and redirects.
 *   /login       → ro
 *   /ru/login    → ru
 *   /en/login    → en
 *   /ro/login    → not canonical; redirected to /login
 */

export function splitLocale(pathname: string): { locale: Locale; rest: string; explicit: boolean } {
  const match = /^\/(ro|ru|en)(?=\/|$)(.*)$/.exec(pathname);
  if (match && isLocale(match[1])) {
    return { locale: match[1], rest: match[2] || '/', explicit: true };
  }
  return { locale: DEFAULT_LOCALE, rest: pathname || '/', explicit: false };
}

/** Builds the canonical path of `path` (locale-free, starting with /) in `locale`. */
export function localizePath(path: string, locale: Locale): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

/** Same page in another language (keeps query and hash). */
export function switchLocaleUrl(pathname: string, search: string, hash: string, target: Locale): string {
  const { rest } = splitLocale(pathname);
  return `${localizePath(rest, target)}${search}${hash}`;
}

/** The canonical URL for /ro/... requests. */
export function canonicalDefaultPath(pathname: string, search = '', hash = ''): string | null {
  const { locale, explicit, rest } = splitLocale(pathname);
  if (!explicit || locale !== DEFAULT_LOCALE) return null;
  return `${rest}${search}${hash}`;
}

/**
 * Language for a visitor landing on "/": their previous choice if any, else the first
 * supported browser language, else English.
 */
export function preferredLocale(saved: string | null | undefined, browserLanguages: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'mo') return 'ro'; // legacy "Moldavian" tag
    if (isLocale(base)) return base;
  }
  return FALLBACK_LOCALE;
}

/** Only same-app relative paths are accepted as post-login destinations. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.length > 300) return null;
  if (/[\\\s]/.test(next)) return null;
  return splitLocale(next).rest;
}

export { LOCALES };
