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

/**
 * "Book again": the same services with the same master, straight to picking a time (as in
 * Fresha or Booksy). Back walks to the master and services steps, already filled in.
 */
export function rebookQuery(appointment: Appointment): string {
  const params = new URLSearchParams({ services: appointment.services.map((s) => s.id).join(','), step: 'time' });
  if (appointment.staff) params.set('staff', appointment.staff.id);
  return `?${params.toString()}`;
}
