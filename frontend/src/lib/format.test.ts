import i18next, { type TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en/common.json';
import ro from '@/locales/ro/common.json';
import ru from '@/locales/ru/common.json';
import type { Locale } from '@/i18n/config';
import { formatDateTime, formatDayLong, formatDayShort, formatDuration, formatPhone, formatPrice } from './format';
import { NBSP } from './typography';

/** Shows no-break spaces as "⍽", so a failing test says where they are. */
const shown = (text: string) => text.replaceAll(NBSP, '⍽');

function translator(locale: Locale): TFunction {
  const i18n = i18next.createInstance();
  void i18n.init({ lng: locale, ns: ['common'], defaultNS: 'common', resources: { [locale]: { common: { ro, ru, en }[locale] } }, initAsync: false });
  return i18n.t;
}

const VISIT = '2026-10-16T11:00:00Z'; // Friday, 14:00 in Chișinău
const TZ = 'Europe/Chisinau';

describe('what the formatters return never breaks inside a value', () => {
  it('keeps an amount with its currency, and "from" with the amount', () => {
    expect(shown(formatPrice(translator('ro'), 550))).toBe('550⍽lei');
    expect(shown(formatPrice(translator('ro'), 1200, 'MDL', true))).toBe('de⍽la⍽1.200⍽lei');
    expect(shown(formatPrice(translator('ru'), 5, 'MDL', true))).toBe('от⍽5⍽лей');
    expect(shown(formatPrice(translator('en'), 300))).toBe('300⍽MDL');
  });

  it('keeps a length whole: "2 h 30 min"', () => {
    expect(shown(formatDuration(translator('ro'), 150))).toBe('2⍽h⍽30⍽min');
    expect(shown(formatDuration(translator('ru'), 45))).toBe('45⍽мин');
    expect(shown(formatDuration(translator('en'), 120))).toBe('2⍽h');
  });

  it('keeps the day with its month and the time with its word; the line may break between them', () => {
    expect(shown(formatDayShort(VISIT, 'en', TZ))).toBe('Fri 16⍽Oct');
    expect(shown(formatDayLong(VISIT, 'ro', TZ))).toBe('vineri, 16⍽octombrie');
    expect(shown(formatDayLong(VISIT, 'ru', TZ))).toBe('пятница, 16⍽октября');
    expect(shown(formatDateTime(VISIT, 'ro', TZ))).toBe('vineri, 16⍽octombrie 2026 la⍽14:00');
    expect(shown(formatDateTime(VISIT, 'ru', TZ))).toBe('пятница, 16⍽октября 2026⍽г. в⍽14:00');
    expect(shown(formatDateTime(VISIT, 'en', TZ))).toBe('Friday, 16⍽October 2026 at⍽14:00');
  });

  it('keeps a phone number on one line', () => {
    expect(shown(formatPhone('+37368230429'))).toBe('+373⍽68⍽230⍽429');
    expect(formatPhone('+40 721 000 000')).toBe('+40 721 000 000');
  });
});
