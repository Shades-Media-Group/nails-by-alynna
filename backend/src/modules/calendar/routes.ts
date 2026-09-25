import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../../context';
import { notFound } from '../../lib/errors';
import { getSettings } from '../settings';
import { buildIcs, verifyCalendarToken } from './service';

const localePath = (locale: string) => (locale === 'ro' ? '' : `/${locale}`);

/**
 * /api/calendar/:token.ics — one visit as an iCalendar file (public, signed link). Served
 * inline as text/calendar, so iPhone and Mac show their "Add to Calendar" sheet and other
 * systems hand it to the default calendar app.
 */
export function calendarRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

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
