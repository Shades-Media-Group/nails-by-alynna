import type { AppointmentDoc, StudioSettings } from '../../db/types';
import { describeVisitTime, visitTime, type BookingChange, type StaffBookingEvent, type VisitInfo, type VisitTime } from '../../lib/emails';
import type { PushPayload } from '../../lib/push';
import { HOUR } from '../../lib/time';
import type { Locale } from '../../lib/validation';

/** Absolute link into the app in the reader's language (Romanian has no prefix). */
export function appLink(appUrl: string, locale: Locale, path: string): string {
  return `${appUrl}${locale === 'ro' ? '' : `/${locale}`}${path}`;
}

/** Everything a reminder or booking message says about one visit, in `locale`. */
export function visitInfo(
  appointment: AppointmentDoc,
  opts: {
    appUrl: string;
    locale: Locale;
    settings: StudioSettings;
    master: string | null;
    /** False for a walk-in client who never signed up: no links that need a login. */
    hasAccount: boolean;
  },
): VisitInfo {
  const { settings, locale, appUrl } = opts;
  const address = [settings.address, settings.city].map((part) => part?.trim()).filter(Boolean).join(', ') || null;
  const directionsUrl =
    settings.mapsUrl ||
    (settings.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address ?? settings.address)}` : null);
  return {
    code: appointment.code,
    start: appointment.start,
    status: appointment.status,
    services: appointment.services.map((s) => s.name[locale] || s.name.en || s.name.ro),
    master: opts.master,
    address,
    bookingUrl: opts.hasAccount ? appLink(appUrl, locale, `/bookings/${appointment._id.toHexString()}`) : null,
    directionsUrl,
    bookUrl: appLink(appUrl, locale, '/book'),
    settingsUrl: opts.hasAccount ? appLink(appUrl, locale, '/profile/notifications') : null,
    changeDeadline: new Date(appointment.start.getTime() - settings.cancellationWindowHours * HOUR),
    studioPhone: settings.phone || null,
  };
}

const PUSH_COPY: Record<
  Locale,
  {
    reminderTitle: (v: VisitTime) => string;
    withMaster: (name: string) => string;
    soon: string;
    requested: string;
    requestedBody: (when: string, master: string | null) => string;
    booked: string;
    confirmed: string;
    rescheduled: string;
    newTime: (when: string) => string;
    cancelled: string;
    cancelledBody: (when: string) => string;
    testTitle: string;
    testBody: string;
  }
> = {
  ro: {
    reminderTitle: (v) =>
      v.relative === 'today' ? `Vizita ta, azi la ${v.time}` : v.relative === 'tomorrow' ? `Vizita ta, mâine la ${v.time}` : `Vizita ta, ${v.date}, la ${v.time}`,
    withMaster: (name) => `cu ${name}`,
    soon: 'Ne vedem curând!',
    requested: 'Cerere trimisă',
    requestedBody: (when, master) => `${when}. ${master ? `${master} confirmă` : 'Salonul confirmă'} în scurt timp.`,
    booked: 'Te-ai programat',
    confirmed: 'Programare confirmată',
    rescheduled: 'Vizita ta a fost mutată',
    newTime: (when) => `Ora nouă: ${when}`,
    cancelled: 'Vizită anulată',
    cancelledBody: (when) => `${when}. Salonul a anulat această vizită.`,
    testTitle: 'Notificările sunt pornite',
    testBody: 'Aici vei primi mementouri pentru vizite și noutăți despre programări.',
  },
  ru: {
    reminderTitle: (v) =>
      v.relative === 'today' ? `Ваш визит сегодня в ${v.time}` : v.relative === 'tomorrow' ? `Ваш визит завтра в ${v.time}` : `Ваш визит: ${v.date}, ${v.time}`,
    withMaster: (name) => `мастер ${name}`,
    soon: 'До встречи!',
    requested: 'Заявка отправлена',
    requestedBody: (when, master) => `${when}. ${master ? `Мастер ${master} скоро подтвердит` : 'Салон скоро подтвердит'} запись.`,
    booked: 'Вы записаны',
    confirmed: 'Запись подтверждена',
    rescheduled: 'Визит перенесён',
    newTime: (when) => `Новое время: ${when}`,
    cancelled: 'Визит отменён',
    cancelledBody: (when) => `${when}. Салон отменил этот визит.`,
    testTitle: 'Уведомления включены',
    testBody: 'Сюда будут приходить напоминания о визитах и изменения записей.',
  },
  en: {
    reminderTitle: (v) =>
      v.relative === 'today' ? `Your visit today at ${v.time}` : v.relative === 'tomorrow' ? `Your visit tomorrow at ${v.time}` : `Your visit on ${v.date} at ${v.time}`,
    withMaster: (name) => `with ${name}`,
    soon: 'See you soon!',
    requested: 'Request sent',
    requestedBody: (when, master) => `${when}. ${master ?? 'The studio'} will confirm it shortly.`,
    booked: "You're booked",
    confirmed: 'Booking confirmed',
    rescheduled: 'Your visit was moved',
    newTime: (when) => `New time: ${when}`,
    cancelled: 'Visit cancelled',
    cancelledBody: (when) => `${when}. The studio cancelled this visit.`,
    testTitle: 'Notifications are on',
    testBody: "You'll get visit reminders and booking updates here.",
  },
};

function servicesLine(visit: VisitInfo, locale: Locale): string {
  const t = PUSH_COPY[locale];
  const services = visit.services.join(', ');
  return visit.master ? `${services} · ${t.withMaster(visit.master)}` : services;
}

export function reminderPush(visit: VisitInfo, appointmentId: string, locale: Locale, timeZone: string, now: Date): PushPayload {
  const t = PUSH_COPY[locale];
  const when = visitTime(visit.start, locale, timeZone, now);
  return {
    title: t.reminderTitle(when),
    body: `${servicesLine(visit, locale)}. ${t.soon}`,
    url: new URL(visit.bookingUrl ?? visit.bookUrl).pathname,
    tag: `visit-${appointmentId}`,
  };
}

export function bookingChangePush(
  visit: VisitInfo,
  appointmentId: string,
  kind: BookingChange,
  locale: Locale,
  timeZone: string,
  now: Date,
): PushPayload {
  const t = PUSH_COPY[locale];
  const when = describeVisitTime(visitTime(visit.start, locale, timeZone, now), locale);
  const tag = `visit-${appointmentId}`;
  if (kind === 'cancelled') return { title: t.cancelled, body: t.cancelledBody(when), url: new URL(visit.bookUrl).pathname, tag };
  const url = new URL(visit.bookingUrl ?? visit.bookUrl).pathname;
  if (kind === 'rescheduled') return { title: t.rescheduled, body: `${t.newTime(when)} · ${servicesLine(visit, locale)}`, url, tag };
  if (kind === 'requested') return { title: t.requested, body: t.requestedBody(when, visit.master), url, tag };
  return { title: kind === 'booked' ? t.booked : t.confirmed, body: `${when} · ${servicesLine(visit, locale)}`, url, tag };
}

const STAFF_PUSH: Record<Locale, Record<StaffBookingEvent, string>> = {
  ro: { requested: 'Cerere nouă de programare', booked: 'Programare nouă', cancelled: 'Clientul a anulat', rescheduled: 'Clientul a mutat vizita' },
  ru: { requested: 'Новая заявка на запись', booked: 'Новая запись', cancelled: 'Клиент отменил визит', rescheduled: 'Клиент перенёс визит' },
  en: { requested: 'New booking request', booked: 'New booking', cancelled: 'The client cancelled', rescheduled: 'The client moved their visit' },
};

/** For the master and the owner: who, when and what, opening the booking in the staff app. */
export function staffBookingPush(
  visit: VisitInfo,
  client: string,
  event: StaffBookingEvent,
  openUrl: string,
  locale: Locale,
  timeZone: string,
  now: Date,
): PushPayload {
  const when = describeVisitTime(visitTime(visit.start, locale, timeZone, now), locale);
  return {
    title: STAFF_PUSH[locale][event],
    body: `${client} · ${when} · ${visit.services.join(', ')}`,
    url: new URL(openUrl).pathname,
    // One notification per booking on the device: a later change replaces the earlier one.
    tag: `staff-visit-${visit.code}`,
  };
}

export function testPush(appUrl: string, locale: Locale): PushPayload {
  const t = PUSH_COPY[locale];
  return { title: t.testTitle, body: t.testBody, url: new URL(appLink(appUrl, locale, '/profile/notifications')).pathname, tag: 'test' };
}
