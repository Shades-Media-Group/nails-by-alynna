import type { AppDeps } from '../../context';
import type { AppointmentDoc, I18nText, StaffDoc, StudioSettings } from '../../db/types';
import { randomToken, sha256Base64Url } from '../../lib/crypto';
import { icsGeo } from '../../lib/maps';
import { DAY } from '../../lib/time';
import type { Locale } from '../../lib/validation';
import { escapeText, fold, stamp } from './service';

/*
 * Calendar sync for masters: a private iCalendar feed (RFC 5545 + RFC 7986) of one master's
 * bookings, which Apple Calendar, Google Calendar and Outlook subscribe to by URL and refresh on
 * their own. The link carries a random 256-bit token (StaffDoc.calendarFeed): no sign-in, so the
 * calendar servers can fetch it, and resetting it cuts off every old copy. A leaked link must not
 * leak much: the feed has clients' names, services and notes, never phone numbers or staff notes;
 * each event links to the booking in the staff app, which asks to sign in.
 */

/** How far back and ahead the feed reaches (a calendar keeps the older events it already has). */
const PAST_DAYS = 60;
const AHEAD_DAYS = 400;
/** How often calendar apps are asked to check for changes (Google decides for itself, every few hours). */
const REFRESH = 'PT15M';

export const FEED_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newFeedToken(): string {
  return randomToken(32);
}

/** The feed's address in every form the calendar apps take. */
export function feedLinks(deps: AppDeps, staff: Pick<StaffDoc, 'name' | 'calendarFeed'>, studioName: string) {
  const feed = staff.calendarFeed;
  if (!feed) return null;
  const url = `${deps.config.appUrl.replace(/\/$/, '')}/api/calendar/feed/${feed.token}.ics`;
  const webcal = url.replace(/^https?:/, 'webcal:');
  const name = `${studioName} · ${staff.name}`;
  return {
    /** https: for "Subscribe by URL" anywhere, and copying. */
    url,
    /** webcal: Apple Calendar (iPhone, iPad, Mac) opens its "Subscribe" prompt for it. */
    webcal,
    /** Google Calendar's "Add calendar" prompt (on a computer: Google offers subscribing only there). */
    google: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(webcal)}`,
    /** Outlook.com's "Subscribe from web" with the address and name filled in. */
    outlook: `https://outlook.live.com/calendar/0/addfromweb/?url=${encodeURIComponent(webcal)}&name=${encodeURIComponent(name)}`,
    createdAt: feed.createdAt.toISOString(),
  };
}

const TEXT = {
  request: { ro: 'Cerere', ru: 'Запрос', en: 'Request' },
  noShow: { ro: 'Nu a venit', ru: 'Не пришла', en: 'No-show' },
  client: { ro: 'Clientă', ru: 'Клиент', en: 'Client' },
  services: { ro: 'Servicii', ru: 'Услуги', en: 'Services' },
  clientNote: { ro: 'Nota clientei', ru: 'Комментарий клиента', en: "Client's note" },
  code: { ro: 'Cod programare', ru: 'Код записи', en: 'Booking code' },
  visit: { ro: 'Programare', ru: 'Запись', en: 'Booking' },
} satisfies Record<string, I18nText>;

const localePath = (locale: Locale) => (locale === 'ro' ? '' : `/${locale}`);

/** One master's bookings as an iCalendar feed; the same bookings give the same text (ETag). */
export function buildStaffFeed(opts: {
  staff: Pick<StaffDoc, 'name'>;
  appointments: AppointmentDoc[];
  settings: StudioSettings;
  locale: Locale;
  appUrl: string;
}): string {
  const { settings, locale } = opts;
  const say = (text: I18nText) => text[locale] || text.ro;
  const location = [settings.address, settings.city].filter(Boolean).join(', ');
  const base = opts.appUrl.replace(/\/$/, '');
  const name = `${settings.name} · ${opts.staff.name}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nails by Alynna//Master calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeText(name)}`,
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${settings.timezone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
    `X-PUBLISHED-TTL:${REFRESH}`,
    'COLOR:hotpink',
  ];
  for (const a of opts.appointments) {
    const client = [a.client.name, a.client.surname].filter(Boolean).join(' ');
    const services = a.services.map((s) => say(s.name)).join(', ');
    const title = [client, services].filter(Boolean).join(' · ') || say(TEXT.visit);
    const prefix = a.status === 'pending' ? `${say(TEXT.request)}: ` : a.status === 'no_show' ? `${say(TEXT.noShow)}: ` : '';
    const link = `${base}${localePath(locale)}/admin/appointments/${a._id.toHexString()}`;
    const details = [
      `${say(TEXT.client)}: ${client}`,
      services ? `${say(TEXT.services)}: ${services}` : '',
      a.notes ? `${say(TEXT.clientNote)}: ${a.notes}` : '',
      `${say(TEXT.code)}: ${a.code}`,
      link,
    ].filter(Boolean);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a._id.toHexString()}@nails-by-alynna`,
      // The last change, not the moment of the request: an unchanged feed reads the same.
      `DTSTAMP:${stamp(a.updatedAt)}`,
      `LAST-MODIFIED:${stamp(a.updatedAt)}`,
      `SEQUENCE:${Math.max(0, Math.floor((a.updatedAt.getTime() - a.createdAt.getTime()) / 1000))}`,
      `DTSTART:${stamp(a.start)}`,
      `DTEND:${stamp(a.end)}`,
      `SUMMARY:${escapeText(prefix + title)}`,
      `DESCRIPTION:${escapeText(details.join('\n'))}`,
      location ? `LOCATION:${escapeText(location)}` : '',
      icsGeo(settings.location),
      `URL:${link}`,
      a.status === 'pending' ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.filter(Boolean).map(fold).join('\r\n')}\r\n`;
}

/** The master's bookings the feed shows: from two months back, cancelled ones left out (they disappear). */
export async function feedAppointments(deps: AppDeps, staff: Pick<StaffDoc, '_id'>): Promise<AppointmentDoc[]> {
  const now = deps.now().getTime();
  return deps.col.appointments
    .find({
      staffId: staff._id,
      status: { $in: ['pending', 'confirmed', 'completed', 'no_show'] },
      start: { $gte: new Date(now - PAST_DAYS * DAY), $lt: new Date(now + AHEAD_DAYS * DAY) },
    })
    .sort({ start: 1 })
    .limit(3000)
    .toArray();
}

/** When the feed last changed: its newest booking change (for Last-Modified). */
export const feedLastModified = (appointments: AppointmentDoc[]): Date | null =>
  appointments.reduce<Date | null>((latest, a) => (!latest || a.updatedAt > latest ? a.updatedAt : latest), null);

export const feedEtag = async (body: string) => `"${(await sha256Base64Url(body)).slice(0, 27)}"`;
