import type { ObjectId } from 'bson';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { addDays } from '../../lib/time';
import { dateSchema, idListSchema, objectIdSchema, parseQuery } from '../../lib/validation';
import { STAFF_ROLES, requireAuth } from '../../middleware/auth';
import { getSettings } from '../settings';
import { bookingWindow, loadAvailabilityContext, slotsForDate } from './service';

const staffParam = z
  .union([z.literal('any'), objectIdSchema])
  .optional()
  .transform((v) => (v === 'any' || v === undefined ? null : v));

export function availabilityRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  /**
   * Who is asking decides the rules: staff see every free time; a client moving a booking can
   * ask for its own time to count as free (`exclude`), but only for their own booking.
   */
  async function mode(c: Context<AppEnv>, exclude: ObjectId | undefined) {
    const user = c.get('user');
    const staff = STAFF_ROLES.includes(user.role);
    if (!exclude) return { staff, excludeAppointmentId: undefined };
    const own = staff || (await deps.col.appointments.countDocuments({ _id: exclude, clientId: user._id }, { limit: 1 })) > 0;
    return { staff, excludeAppointmentId: own ? exclude : undefined };
  }

  /** Per-day counts for the date strip (one query for the whole range). */
  app.get('/days', async (c) => {
    const q = parseQuery(
      c,
      z.object({
        serviceIds: idListSchema(),
        staffId: staffParam,
        from: dateSchema.optional(),
        days: z.coerce.number().int().min(1).max(62).default(21),
        exclude: objectIdSchema.optional(),
      }),
    );
    const { staff, excludeAppointmentId } = await mode(c, q.exclude);
    const now = deps.now();
    const window = bookingWindow(await getSettings(deps), now, staff);
    const from = q.from && q.from > window.first ? q.from : window.first;
    const lastRequested = addDays(from, q.days - 1);
    const to = lastRequested < window.last ? lastRequested : window.last;

    const ctx = await loadAvailabilityContext(deps, { serviceIds: q.serviceIds, staffId: q.staffId, from, to, excludeAppointmentId });
    const days: Array<{ date: string; slots: number }> = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days.push({ date: d, slots: slotsForDate(ctx, d, now, { staff }).length });
    }
    return c.json({
      durationMin: ctx.durationMin,
      window,
      staffCount: ctx.staff.length,
      days,
    });
  });

  app.get('/slots', async (c) => {
    const q = parseQuery(
      c,
      z.object({ serviceIds: idListSchema(), staffId: staffParam, date: dateSchema, exclude: objectIdSchema.optional() }),
    );
    const { staff, excludeAppointmentId } = await mode(c, q.exclude);
    const ctx = await loadAvailabilityContext(deps, {
      serviceIds: q.serviceIds,
      staffId: q.staffId,
      from: q.date,
      to: q.date,
      excludeAppointmentId,
    });
    return c.json({
      date: q.date,
      durationMin: ctx.durationMin,
      slots: slotsForDate(ctx, q.date, deps.now(), { staff }),
    });
  });

  return app;
}
