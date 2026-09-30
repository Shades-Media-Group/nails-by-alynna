import { describe, expect, it } from 'vitest';
import { calendarChoices, fileAction, googleAppIntent, googleEventUrl, opensSafariLinks, outlookEventUrl } from './calendarLinks';
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

describe('the calendar file, per device', () => {
  const url = 'https://app.example/api/calendar/abc.ics';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
  const oldIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

  it('lets Safari show its "Add to Calendar" sheet, from a tab or from the Home Screen app', () => {
    expect(fileAction(url, { os: 'ios', standalone: false, ua: iphone })).toEqual({ kind: 'navigate', href: url });
    // The app on the Home Screen can't show the file (a blank page): Safari can.
    expect(fileAction(url, { os: 'ios', standalone: true, ua: iphone })).toEqual({ kind: 'safari', href: `x-safari-${url}` });
    expect(fileAction(url, { os: 'ipados', standalone: true, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toEqual({
      kind: 'safari',
      href: `x-safari-${url}`,
    });
    // Before iOS 17 there is no such link: the in-app browser, with its Safari button.
    expect(fileAction(url, { os: 'ios', standalone: true, ua: oldIphone })).toEqual({ kind: 'open', href: url });
    expect(opensSafariLinks(oldIphone)).toBe(false);
  });

  it('downloads it everywhere else, never leaving a blank page', () => {
    expect(fileAction(url, { os: 'android', standalone: true, ua: 'Android' })).toEqual({ kind: 'download', href: url });
    expect(fileAction(url, { os: 'android', standalone: false, ua: 'Android' })).toEqual({ kind: 'download', href: url });
    expect(fileAction(url, { os: 'desktop', standalone: false, ua: 'Mac' })).toEqual({ kind: 'download', href: url });
  });
});
