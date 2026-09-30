import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../../context';
import { notFound } from '../../lib/errors';
import { getSettings } from '../settings';
import { FEED_TOKEN, buildStaffFeed, feedAppointments, feedEtag, feedLastModified } from './feed';
import { buildIcs, verifyCalendarToken } from './service';

const localePath = (locale: string) => (locale === 'ro' ? '' : `/${locale}`);

/**
 * /api/calendar/:token.ics — one visit as an iCalendar file (public, signed link). Served
 * inline as text/calendar, so iPhone and Mac show their "Add to Calendar" sheet and other
 * systems hand it to the default calendar app.
 */
export function calendarRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  /**
   * /api/calendar/feed/:token.ics — a master's bookings as a subscribed calendar (secret link,
   * no sign-in: calendar servers fetch it). An unchanged feed answers 304 to a calendar that
   * already has it.
   */
  app.get('/feed/:file', async (c) => {
    const token = c.req.param('file').replace(/\.ics$/, '');
    if (!FEED_TOKEN.test(token)) throw notFound('Calendar');
    const staff = await deps.col.staff.findOne({ 'calendarFeed.token': token, isActive: true });
    if (!staff) throw notFound('Calendar');
    const [settings, appointments, owner] = await Promise.all([
      getSettings(deps),
      feedAppointments(deps, staff),
      staff.userId ? deps.col.users.findOne({ _id: staff.userId }, { projection: { locale: 1 } }) : null,
    ]);
    const body = buildStaffFeed({ staff, appointments, settings, locale: owner?.locale ?? 'ro', appUrl: deps.config.appUrl });
    const etag = await feedEtag(body);
    const modified = feedLastModified(appointments);
    const headers: Record<string, string> = {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="nails-by-alynna.ics"',
      'Cache-Control': 'private, no-cache',
      ETag: etag,
      'X-Robots-Tag': 'noindex, nofollow',
      ...(modified ? { 'Last-Modified': modified.toUTCString() } : {}),
    };
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
    return c.body(body, 200, headers);
  });

  app.get('/:file', async (c) => {
    const id = await verifyCalendarToken(deps, c.req.param('file').replace(/\.ics$/, ''));
    if (!id) throw notFound('Calendar event');
    const appointment = await deps.col.appointments.findOne({ _id: id, status: { $in: ['pending', 'confirmed', 'completed'] } });
    if (!appointment) throw notFound('Calendar event');
    const [settings, client] = await Promise.all([
      getSettings(deps),
      deps.col.users.findOne({ _id: appointment.clientId }, { projection: { locale: 1 } }),
    ]);
    const locale = client?.locale ?? 'ro';
    const bookingUrl = `${deps.config.appUrl.replace(/\/$/, '')}${localePath(locale)}/bookings/${appointment._id.toHexString()}`;
    const body = buildIcs({ appointment, settings, locale, bookingUrl });
    return c.body(body, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="nails-by-alynna-${appointment.code}.ics"`,
      'Cache-Control': 'private, no-store',
    });
  });

  return app;
}
