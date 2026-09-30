import type { CalendarEvent } from '@/lib/ics';
import { currentPlatform, type OS } from '@/lib/platform';

/*
 * Where "Add to calendar" sends a visit on each device: the phone's own calendar app first, never
 * a web page that asks to sign in when the phone can do without.
 */

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Google Calendar's "new event" page with the visit filled in. */
export function googleEventUrl(event: CalendarEvent, timeZone: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${stamp(event.start)}/${stamp(event.end)}`,
    details: event.description,
    location: event.location,
    ctz: timeZone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * The same page handed to the Google Calendar app on Android (Chrome opens its "new event"
 * screen, already signed in); without the app, Chrome opens the page instead.
 */
export function googleAppIntent(event: CalendarEvent, timeZone: string): string {
  const web = googleEventUrl(event, timeZone);
  const path = web.replace(/^https:\/\//, '');
  return `intent://${path}#Intent;scheme=https;package=com.google.android.calendar;S.browser_fallback_url=${encodeURIComponent(web)};end`;
}

/** Outlook on the web's "new event" page with the visit filled in. */
export function outlookEventUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: new Date(event.start).toISOString(),
    enddt: new Date(event.end).toISOString(),
    body: event.description,
    location: event.location,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export type CalendarChoice = 'device' | 'googleApp' | 'googleWeb' | 'outlook' | 'file';

/**
 * Which calendars to offer here, the phone's own first. iPhone and iPad: only the Calendar app
 * (its "Add to Calendar" sheet also saves to a Google or Outlook account added on the phone), so
 * one tap and no web page asking to sign in. Android: the Google Calendar app, or the file for
 * Samsung Calendar and others. A computer: Google, Outlook or the file.
 */
export function calendarChoices(os: OS = currentPlatform().os): CalendarChoice[] {
  if (os === 'ios' || os === 'ipados') return ['device'];
  if (os === 'android') return ['googleApp', 'file'];
  return ['googleWeb', 'outlook', 'file'];
}
