import { describe, expect, it } from 'vitest';
import {
  canonicalDefaultPath,
  localizePath,
  preferredLocale,
  safeNextPath,
  signedInPath,
  splitLocale,
  switchLocaleUrl,
} from './routing';

describe('locale routing', () => {
  it('reads the locale from the path', () => {
    expect(splitLocale('/login')).toEqual({ locale: 'ro', rest: '/login', explicit: false });
    expect(splitLocale('/ru/login')).toEqual({ locale: 'ru', rest: '/login', explicit: true });
    expect(splitLocale('/en')).toEqual({ locale: 'en', rest: '/', explicit: true });
    expect(splitLocale('/ro/')).toEqual({ locale: 'ro', rest: '/', explicit: true });
    expect(splitLocale('/rus/x')).toEqual({ locale: 'ro', rest: '/rus/x', explicit: false });
  });

  it('keeps Romanian unprefixed and prefixes the others', () => {
    expect(localizePath('/login', 'ro')).toBe('/login');
    expect(localizePath('/login', 'ru')).toBe('/ru/login');
    expect(localizePath('/', 'en')).toBe('/en');
    expect(localizePath('home', 'en')).toBe('/en/home');
  });

  it('switches language on the same page', () => {
    expect(switchLocaleUrl('/ru/bookings/1', '?x=1', '#a', 'ro')).toBe('/bookings/1?x=1#a');
    expect(switchLocaleUrl('/home', '', '', 'en')).toBe('/en/home');
  });

  it('canonicalises /ro URLs', () => {
    expect(canonicalDefaultPath('/ro/login', '?a=1')).toBe('/login?a=1');
    expect(canonicalDefaultPath('/ro')).toBe('/');
    expect(canonicalDefaultPath('/ru/login')).toBeNull();
    expect(canonicalDefaultPath('/login')).toBeNull();
  });

  it('prefers the saved language, then the browser, then English', () => {
    expect(preferredLocale('ru', ['en-US'])).toBe('ru');
    expect(preferredLocale(null, ['ro-MD', 'en'])).toBe('ro');
    expect(preferredLocale(null, ['ru-RU'])).toBe('ru');
    expect(preferredLocale(null, ['mo'])).toBe('ro');
    expect(preferredLocale(null, ['de-DE', 'fr'])).toBe('en');
    expect(preferredLocale('xx', [])).toBe('en');
  });

  it('lands a signed-in person in the language saved on their account, Romanian by default', () => {
    expect(signedInPath('/admin', 'ro')).toBe('/admin');
    expect(signedInPath('/home', 'ru')).toBe('/ru/home');
    expect(signedInPath('/bookings/1?x=1', 'en')).toBe('/en/bookings/1?x=1');
    expect(signedInPath('/home', undefined)).toBe('/home');
    expect(signedInPath('/home', 'de')).toBe('/home');
  });

  it('only accepts same-app redirect targets', () => {
    expect(safeNextPath('/ru/book?services=1')).toBe('/book?services=1');
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('/\\evil')).toBeNull();
  });
});
