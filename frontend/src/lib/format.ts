import type { TFunction } from 'i18next';
import { LOCALE_TAGS, type Locale } from '@/i18n/config';
import { NBSP } from './typography';

/**
 * Formatting in the studio's time zone and currency. Times are always shown in Chișinău time,
 * whatever the device's zone, so a visit reads the same for the client and the studio. What
 * these return never breaks inside an amount, a length or a date part ("550 lei", "2 h 30 min",
 * "16 octombrie", "la 14:00"): the spaces there are no-break spaces, from the locale strings
 * (common:price, common:duration) or added here to Intl's dates.
 */

export const STUDIO_TZ_FALLBACK = 'Europe/Chisinau';

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: Locale, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { timeZone, ...options });
    cache.set(key, f);
  }
  return f;
}

/**
 * The parts of an Intl date that read as one: the day and its month ("16 octombrie", "16 Oct"),
 * the year and Russian "г.", and a time after a short word ("la 14:00", "в 14:00", "at 14:00").
 * A line can still break after the weekday, before the year and before "la", "в", "at", so a
 * date in large type still fits a narrow card.
 */
function keepDateTogether(text: string): string {
  return text
    .replace(/(^|\s)(\d{1,2}) (?=\p{L})/gu, `$1$2${NBSP}`)
    .replace(/(\d{4}) (?=г\.)/gu, `$1${NBSP}`)
    .replace(/(^|\s)(\p{L}{1,2}) (?=\d{1,2}:\d{2})/gu, `$1$2${NBSP}`);
}

export function formatPrice(t: TFunction, amount: number, currency = 'MDL', from = false): string {
  // Digit groups never split either (the narrow no-break space is not in every font).
  const number = new Intl.NumberFormat('ro-MD', { maximumFractionDigits: 0 }).format(amount).replace(/[\u00a0\u202f ]/g, NBSP);
  const value =
    currency === 'MDL'
      ? t('common:price.currencyMdl', { amount: number })
      : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  return from ? t('common:price.from', { amount: value }) : value;
}

export function formatDuration(t: TFunction, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('common:duration.min', { m });
  if (m === 0) return t('common:duration.h', { h });
  return t('common:duration.hm', { h, m });
}

export function formatTime(iso: string | Date, locale: Locale, timeZone: string): string {
  return dtf(locale, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** "Thu, 16 Oct" */
export function formatDayShort(iso: string | Date, locale: Locale, timeZone: string): string {
  return keepDateTogether(dtf(locale, timeZone, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)));
}

/** "Thursday, 16 October" */
export function formatDayLong(iso: string | Date, locale: Locale, timeZone: string): string {
  return keepDateTogether(dtf(locale, timeZone, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)));
}

/** "Thursday, 16 October 2026 at 14:00" */
export function formatDateTime(iso: string | Date, locale: Locale, timeZone: string): string {
  return keepDateTogether(
    dtf(locale, timeZone, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso)),
  );
}

/** Calendar date (YYYY-MM-DD) of an instant in the studio zone. */
export function zonedDate(instant: Date, timeZone: string): string {
  const parts = dtf('en', timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Noon UTC of a calendar date: safe to format as that date in any European zone. */
export function dateToInstant(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function relativeDayLabel(t: TFunction, date: string, today: string): string | null {
  if (date === today) return t('common:time.today');
  if (date === addDays(today, 1)) return t('common:time.tomorrow');
  return null;
}

/** Weekday / day number / month for date chips. */
export function dayParts(date: string, locale: Locale) {
  const instant = dateToInstant(date);
  return {
    weekday: dtf(locale, 'UTC', { weekday: 'short' }).format(instant).replace('.', ''),
    day: dtf(locale, 'UTC', { day: 'numeric' }).format(instant),
    month: dtf(locale, 'UTC', { month: 'short' }).format(instant).replace('.', ''),
  };
}

/**
 * Month and year to follow "since": "March 2026", "martie 2026", and in Russian the genitive
 * "марта 2026" (Intl's month alone is the nominative "март", wrong after "с").
 */
export function monthYearSince(iso: string | Date, locale: Locale, timeZone: string): string {
  const instant = new Date(iso);
  const year = dtf(locale, timeZone, { year: 'numeric' }).format(instant).replace(/\D/g, '');
  const month =
    dtf(locale, timeZone, { day: 'numeric', month: 'long' })
      .formatToParts(instant)
      .find((part) => part.type === 'month')?.value ?? '';
  return `${month}${NBSP}${year}`;
}

export function fullName(person: { name: string; surname?: string }): string {
  return [person.name, person.surname].filter(Boolean).join(' ');
}

/** +37369123456 → +373 69 123 456 (display only, never split over two lines). */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const md = /^\+373(\d{2})(\d{3})(\d{3})$/.exec(phone);
  return md ? ['+373', md[1], md[2], md[3]].join(NBSP) : phone;
}
