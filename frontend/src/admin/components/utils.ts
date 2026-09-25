import { LOCALE_TAGS, type Locale } from '@/i18n/config';
import { isEmail, nameIssue, normalizePhone } from '@/lib/validation';
import type { I18nText } from '@/types/api';
import type { AdminStaff, TimeInterval, WeeklyHours } from '../api';
import { isTime, timeToMinutes } from './time';

export const emptyText = (): I18nText => ({ ro: '', ru: '', en: '' });

/** Empty Russian or English fields fall back to the Romanian text instead of staying blank. */
export function fillFromRo(text: I18nText): I18nText {
  return { ro: text.ro.trim(), ru: text.ru.trim() || text.ro.trim(), en: text.en.trim() || text.ro.trim() };
}

/** Walk-ins booked without an email get an address on the reserved .invalid domain. */
export const isPlaceholderEmail = (email: string | null | undefined): boolean => !email || email.endsWith('@no-email.invalid');

const digits = (phone: string) => phone.replace(/[^\d+]/g, '');

export const telHref = (phone: string) => `tel:${digits(phone)}`;

/** A WhatsApp chat with this text, addressed to the phone when there is one. */
export const whatsappHref = (text: string, phone?: string | null) =>
  `https://wa.me/${phone ? digits(phone).replace('+', '') : ''}?text=${encodeURIComponent(text)}`;

/** An SMS draft; `?&body=` is the form both iOS and Android read. */
export const smsHref = (text: string, phone?: string | null) => `sms:${phone ? digits(phone) : ''}?&body=${encodeURIComponent(text)}`;

const relativeFormats = new Map<Locale, Intl.RelativeTimeFormat>();

/** "5 minutes ago", "yesterday", "in 3 hours": the unit that reads naturally. */
export function relativeTime(iso: string, locale: Locale, now: number): string {
  let rtf = relativeFormats.get(locale);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(LOCALE_TAGS[locale], { numeric: 'auto' });
    relativeFormats.set(locale, rtf);
  }
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 45 * 60) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 26 * 86400) return rtf.format(Math.round(seconds / 86400), 'day');
  if (abs < 320 * 86400) return rtf.format(Math.round(seconds / (30 * 86400)), 'month');
  return rtf.format(Math.round(seconds / (365 * 86400)), 'year');
}

// 2024-01-01 was a Monday: day i of the week is 2024-01-(i+1).
const weekdayFormats = new Map<string, Intl.DateTimeFormat>();
/** Localised weekday name; `index` 0 = Monday … 6 = Sunday. */
export function weekdayName(index: number, locale: Locale, width: 'long' | 'short' = 'long'): string {
  const key = `${locale}|${width}`;
  let f = weekdayFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { weekday: width, timeZone: 'UTC' });
    weekdayFormats.set(key, f);
  }
  const name = f.format(new Date(Date.UTC(2024, 0, 1 + index, 12))).replace('.', '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Working week in one line: consecutive days with the same hours merge into a range,
 * e.g. "Mon–Fri 10:00–19:00 · Sat 10:00–15:00". Days off are left out.
 */
export function weekSummary(weekly: WeeklyHours, locale: Locale): string {
  const key = (day: number) => (weekly[day] ?? []).map((i) => `${i.start}–${i.end}`).join(', ');
  const groups: Array<{ from: number; to: number; hours: string }> = [];
  for (let day = 0; day < 7; day++) {
    const hours = key(day);
    if (!hours) continue;
    const last = groups.at(-1);
    if (last && last.to === day - 1 && last.hours === hours) last.to = day;
    else groups.push({ from: day, to: day, hours });
  }
  return groups
    .map((g) => {
      const days = g.from === g.to ? weekdayName(g.from, locale, 'short') : `${weekdayName(g.from, locale, 'short')}–${weekdayName(g.to, locale, 'short')}`;
      return `${days} ${g.hours}`;
    })
    .join(' · ');
}

/** Case- and accent-insensitive match ("Manichiură" matches "manichiura"). */
export function matches(text: string, term: string): boolean {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return fold(text).includes(fold(term.trim()));
}

/** Masters clients can book who do every chosen service. */
export function eligibleMasters(staff: AdminStaff[] | undefined, serviceIds: string[]): AdminStaff[] {
  return (staff ?? []).filter(
    (member) => member.isActive && member.isBookable && (!member.serviceIds || serviceIds.every((id) => member.serviceIds!.includes(id))),
  );
}

export interface ClientFieldValues {
  name: string;
  surname: string;
  phone: string;
  email: string;
}

/**
 * Field problems as common:validation codes, mirroring the API's rules (it stays the authority):
 * names in letters, a phone the API can normalise, an email only if given.
 */
export function clientFieldIssues(values: ClientFieldValues, { phoneRequired = true } = {}): Partial<Record<keyof ClientFieldValues, string>> {
  const issues: Partial<Record<keyof ClientFieldValues, string>> = {};
  const name = nameIssue(values.name);
  if (name) issues.name = name;
  const surname = nameIssue(values.surname);
  if (surname) issues.surname = surname;
  if (!values.phone.trim()) {
    if (phoneRequired) issues.phone = 'required';
  } else if (!normalizePhone(values.phone)) {
    issues.phone = 'invalid_phone';
  }
  if (values.email.trim() && !isEmail(values.email)) issues.email = 'invalid_email';
  return issues;
}

/** A search that found nobody becomes the start of a new client: a phone, or a name and surname. */
export function clientFromSearch(term: string): ClientFieldValues {
  const text = term.trim();
  if (/^[+\d][\d\s()-]{5,}$/.test(text)) return { name: '', surname: '', phone: text, email: '' };
  if (text.includes('@')) return { name: '', surname: '', phone: '', email: text };
  const [name = '', ...rest] = text.split(/\s+/);
  return { name, surname: rest.join(' '), phone: '', email: '' };
}

/** What is wrong with one day's hours, as a validation code (null when fine). */
export function dayIssue(intervals: TimeInterval[]): 'invalid_time' | 'end_before_start' | 'overlapping' | null {
  if (intervals.some((i) => !isTime(i.start) || !isTime(i.end))) return 'invalid_time';
  if (intervals.some((i) => timeToMinutes(i.start) >= timeToMinutes(i.end))) return 'end_before_start';
  const sorted = [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  if (sorted.some((cur, i) => i > 0 && timeToMinutes(sorted[i - 1]!.end) > timeToMinutes(cur.start))) return 'overlapping';
  return null;
}
