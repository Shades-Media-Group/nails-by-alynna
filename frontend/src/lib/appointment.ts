import type { TFunction } from 'i18next';
import type { Locale } from '@/i18n/config';
import { localizePath } from '@/i18n/routing';
import type { Appointment, I18nText } from '@/types/api';
import type { CalendarEvent } from './ics';

export function serviceNames(appointment: Appointment, pick: (text: I18nText) => string): string {
  return appointment.services.map((s) => pick(s.name)).join(', ');
}

export function calendarEventFor(
  appointment: Appointment,
  opts: { t: TFunction; locale: Locale; pick: (text: I18nText) => string; address: string },
): CalendarEvent {
  const url = `${window.location.origin}${localizePath(`/bookings/${appointment.id}`, opts.locale)}`;
  return {
    uid: appointment.id,
    title: opts.t('booking:calendar.title', { services: serviceNames(appointment, opts.pick) }),
    description: opts.t('booking:calendar.description', { code: appointment.code, url }),
    location: opts.address,
    start: appointment.start,
    end: appointment.end,
    url,
  };
}

/** Service ids of a past visit, for "Book again". */
export function rebookQuery(appointment: Appointment): string {
  return `?services=${appointment.services.map((s) => s.id).join(',')}`;
}
