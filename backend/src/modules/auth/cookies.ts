import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppConfig } from '../../config';

/**
 * Cookie layout
 * - access  (`__Host-nba_at`): short-lived JWT, httpOnly, SameSite=Strict, Path=/
 * - refresh (`__Secure-nba_rt`): opaque rotating token, httpOnly, SameSite=Strict, Path=/api/auth
 * - hint    (`nba_sess`): non-secret "a session probably exists" flag so the app can skip a
 *   network round-trip at boot for signed-out visitors. Contains no credentials.
 * - oauth   (`__Secure-nba_oa`): encrypted OAuth state + PKCE verifier, SameSite=Lax
 *   (must survive the top-level redirect back from Google).
 * Prefixes need HTTPS, so plain-HTTP local development uses unprefixed names.
 */
export function cookieNames(config: AppConfig) {
  const secure = config.cookieSecure;
  return {
    access: secure ? '__Host-nba_at' : 'nba_at',
    refresh: secure ? '__Secure-nba_rt' : 'nba_rt',
    hint: 'nba_sess',
    oauth: secure ? '__Secure-nba_oa' : 'nba_oa',
  };
}

export const REFRESH_PATH = '/api/auth';
export const OAUTH_PATH = '/api/auth/google';

export function setSessionCookies(
  c: Context,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string; remember: boolean },
): void {
  const names = cookieNames(config);
  const secure = config.cookieSecure;
  const persistentMaxAge = tokens.remember ? config.session.rememberDays * 86_400 : undefined;

  setCookie(c, names.access, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge: config.jwt.accessTtlSec,
  });
  setCookie(c, names.refresh, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: REFRESH_PATH,
    ...(persistentMaxAge ? { maxAge: persistentMaxAge } : {}),
  });
  setCookie(c, names.hint, '1', {
    httpOnly: false,
    secure,
    sameSite: 'Strict',
    path: '/',
    ...(persistentMaxAge ? { maxAge: persistentMaxAge } : {}),
  });
}

export function setAccessCookie(c: Context, config: AppConfig, accessToken: string): void {
  setCookie(c, cookieNames(config).access, accessToken, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Strict',
    path: '/',
    maxAge: config.jwt.accessTtlSec,
  });
}

export function clearSessionCookies(c: Context, config: AppConfig): void {
  const names = cookieNames(config);
  const secure = config.cookieSecure;
  deleteCookie(c, names.access, { path: '/', secure });
  deleteCookie(c, names.refresh, { path: REFRESH_PATH, secure });
  deleteCookie(c, names.hint, { path: '/', secure });
}

export function readAccessToken(c: Context, config: AppConfig): string | undefined {
  return getCookie(c, cookieNames(config).access);
}

export function readRefreshToken(c: Context, config: AppConfig): string | undefined {
  return getCookie(c, cookieNames(config).refresh);
}
