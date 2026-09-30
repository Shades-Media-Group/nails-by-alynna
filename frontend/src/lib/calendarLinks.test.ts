import { describe, expect, it } from 'vitest';
import { calendarChoices, googleAppIntent, googleEventUrl, outlookEventUrl } from './calendarLinks';
import type { CalendarEvent } from './ics';

const event: CalendarEvent = {
  uid: 'a1',
  title: 'Nails by Alynna: Gel polish',
  description: 'Booking K7QM2X. Manage it in the app: https://example.test/bookings/a1',
  location: 'Str. Exemplu 1, Chișinău',
  start: '2026-10-16T11:00:00.000Z',
  end: '2026-10-16T12:30:00.000Z',
};

describe('add to calendar, per device', () => {
  it("offers the phone's own calendar first, and never Google's web page on an iPhone", () => {
    expect(calendarChoices('ios')).toEqual(['device']);
    expect(calendarChoices('ipados')).toEqual(['device']);
    expect(calendarChoices('android')).toEqual(['googleApp', 'file']);
    expect(calendarChoices('desktop')).toEqual(['googleWeb', 'outlook', 'file']);
  });

  it("fills in Google Calendar's new event, in the studio's time zone", () => {
    const url = new URL(googleEventUrl(event, 'Europe/Chisinau'));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'TEMPLATE',
      text: event.title,
      dates: '20261016T110000Z/20261016T123000Z',
      details: event.description,
      location: event.location,
      ctz: 'Europe/Chisinau',
    });
  });

  it('hands the same page to the Google Calendar app on Android, with the page as the fallback', () => {
    const intent = googleAppIntent(event, 'Europe/Chisinau');
    const web = googleEventUrl(event, 'Europe/Chisinau');
    expect(intent.startsWith(`intent://${web.slice('https://'.length)}#Intent;`)).toBe(true);
    expect(intent).toContain(';scheme=https;');
    expect(intent).toContain(';package=com.google.android.calendar;');
    expect(intent).toContain(`;S.browser_fallback_url=${encodeURIComponent(web)};`);
    expect(intent.endsWith(';end')).toBe(true);
    // The fallback's own "#" and ";" can't cut the intent short.
    expect(intent.split('#Intent;')).toHaveLength(2);
  });

  it("fills in Outlook's new event", () => {
    const url = new URL(outlookEventUrl(event));
    expect(url.hostname).toBe('outlook.live.com');
    expect(url.searchParams.get('subject')).toBe(event.title);
    expect(url.searchParams.get('startdt')).toBe(event.start);
    expect(url.searchParams.get('rru')).toBe('addevent');
  });
});
