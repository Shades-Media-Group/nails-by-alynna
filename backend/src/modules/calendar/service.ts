import { ObjectId } from 'mongodb';
import type { AppDeps } from '../../context';
import type { AppointmentDoc, I18nText, StudioSettings } from '../../db/types';
import { base64UrlEncode, timingSafeEqualStr } from '../../lib/crypto';
import type { Locale } from '../../lib/validation';

/*
 * "Add to calendar" links. Each upcoming visit gets a signed, expiring URL of an .ics file that
 * the phone opens with its own calendar UI. Signed rather than behind the session cookie, because
 * iOS opens it in a separate browser view that may not carry the app's cookies. The file holds
 * only the visit (time, services, studio address, booking code): no personal details.
 */

const encoder = new TextEncoder();
const DAY_SEC = 86_400;

async function hmac(secret: Uint8Array, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`calendar:${payload}`));
  return base64UrlEncode(new Uint8Array(signature));
}

/** A link valid until 30 days after the visit ends. */
export async function calendarToken(deps: AppDeps, appointment: Pick<AppointmentDoc, '_id' | 'end'>): Promise<string> {
  const exp = Math.floor(appointment.end.getTime() / 1000) + 30 * DAY_SEC;
  const payload = `${appointment._id.toHexString()}.${exp}`;
  return `${payload}.${await hmac(deps.config.jwt.secret, payload)}`;
}

export async function verifyCalendarToken(deps: AppDeps, token: string): Promise<ObjectId | null> {
  const match = /^([a-f0-9]{24})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, id, exp, signature] = match as unknown as [string, string, string, string];
  if (Number(exp) * 1000 < deps.now().getTime()) return null;
  const payload = `${id}.${exp}`;
  for (const secret of [deps.config.jwt.secret, deps.config.jwt.previousSecret]) {
    if (secret && timingSafeEqualStr(await hmac(secret, payload), signature)) return new ObjectId(id);
  }
  return null;
}

export const calendarUrl = (deps: AppDeps, token: string) => `${deps.config.appUrl.replace(/\/$/, '')}/api/calendar/${token}.ics`;

/** Calendar links for the visits still to come (keyed by appointment id). */
export async function calendarLinks(deps: AppDeps, docs: AppointmentDoc[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const upcoming = docs.filter((d) => (d.status === 'pending' || d.status === 'confirmed') && d.end.getTime() > deps.now().getTime());
  await Promise.all(
    upcoming.map(async (d) => {
      links.set(d._id.toHexString(), calendarUrl(deps, await calendarToken(deps, d)));
    }),
  );
  return links;
}

// ── iCalendar (RFC 5545) ─────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

/** Lines longer than 75 octets are folded (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const width = encoder.encode(ch).length;
    if (size + width > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += width;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const TITLE: Record<Locale, string> = { ro: 'Programare', ru: 'Запись', en: 'Appointment' };
const CODE: Record<Locale, string> = { ro: 'Cod programare', ru: 'Код записи', en: 'Booking code' };
const REMINDER: Record<Locale, string> = { ro: 'Programarea ta începe curând', ru: 'Скоро ваша запись', en: 'Your visit starts soon' };

export function buildIcs(opts: {
  appointment: AppointmentDoc;
  settings: StudioSettings;
  locale: Locale;
  bookingUrl: string;
}): string {
  const { appointment: a, settings, locale } = opts;
  const pick = (text: I18nText) => text[locale] || text.ro;
  const services = a.services.map((s) => pick(s.name)).join(', ');
  const location = [settings.address, settings.city].filter(Boolean).join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nails by Alynna//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a._id.toHexString()}@nails-by-alynna`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(a.start)}`,
    `DTEND:${stamp(a.end)}`,
    `SUMMARY:${escapeText(`${settings.name}: ${services || TITLE[locale]}`)}`,
    `DESCRIPTION:${escapeText(`${CODE[locale]}: ${a.code}\n${opts.bookingUrl}`)}`,
    location ? `LOCATION:${escapeText(location)}` : '',
    `URL:${opts.bookingUrl}`,
    a.status === 'pending' ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT1H',
    `DESCRIPTION:${escapeText(REMINDER[locale])}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
