import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES } from '../../db/types';
import { addDays, dayRange, isoWeekday, timeToMinutes, todayIn } from '../../lib/time';
import { dateSchema, parseQuery } from '../../lib/validation';
import { getSettings } from '../settings';
import { staffSummaries, toStaffAppointment } from '../appointments/service';

export function dashboardRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const settings = await getSettings(deps);
    const now = deps.now();
    const tz = settings.timezone;
    const q = parseQuery(c, z.object({ date: dateSchema.optional() }));
    const date = q.date ?? todayIn(tz, now);
    const today = dayRange(date, tz);
    const weekStartDate = addDays(date, 1 - isoWeekday(date));
    const week = { start: dayRange(weekStartDate, tz).start, end: dayRange(addDays(weekStartDate, 6), tz).end };
    const monthStart = dayRange(`${date.slice(0, 8)}01`, tz).start;
    const next7End = dayRange(addDays(date, 7), tz).end;
    const last30 = new Date(now.getTime() - 30 * 86_400_000);

    const col = deps.col.appointments;
    const [todayDocs, weekAgg, pendingCount, next7Count, newClients, topServices, staffDocs] =
      await Promise.all([
        col.find({ start: { $gte: today.start, $lt: today.end }, status: { $ne: 'cancelled' } }).sort({ start: 1 }).toArray(),
        col
          .aggregate<{ _id: string; count: number; revenue: number }>([
            { $match: { start: { $gte: week.start, $lt: week.end }, status: { $ne: 'cancelled' } } },
            { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$totalPrice' } } },
          ])
          .toArray(),
        col.countDocuments({ status: 'pending', start: { $gt: now } }),
        col.countDocuments({ status: { $in: ACTIVE_STATUSES }, start: { $gte: now, $lt: next7End } }),
        deps.col.users.countDocuments({ role: 'client', deletedAt: null, createdAt: { $gte: monthStart } }),
        col
          .aggregate<{ _id: { toString(): string }; count: number; name: Record<string, string> }>([
            { $match: { start: { $gte: last30 }, status: { $in: ['confirmed', 'completed'] } } },
            { $unwind: '$services' },
            { $group: { _id: '$services.serviceId', count: { $sum: 1 }, name: { $first: '$services.name' } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ])
          .toArray(),
        deps.col.staff.find({ isActive: true, isBookable: true }).toArray(),
      ]);

    const staffMap = await staffSummaries(deps, todayDocs.map((d) => d.staffId));
    const byStatus = (status: string) => todayDocs.filter((d) => d.status === status).length;
    const workingMinutes = staffDocs.reduce((sum, s) => {
      const intervals = s.weekly[isoWeekday(date) - 1] ?? [];
      return sum + intervals.reduce((acc, i) => acc + timeToMinutes(i.end) - timeToMinutes(i.start), 0);
    }, 0);
    const bookedMinutes = todayDocs
      .filter((d) => d.status !== 'no_show')
      .reduce((sum, d) => sum + d.durationMin, 0);
    const weekCompleted = weekAgg.find((w) => w._id === 'completed');

    return c.json({
      date,
      today: {
        total: todayDocs.length,
        pending: byStatus('pending'),
        confirmed: byStatus('confirmed'),
        completed: byStatus('completed'),
        noShow: byStatus('no_show'),
        expectedRevenue: todayDocs
          .filter((d) => d.status !== 'no_show')
          .reduce((sum, d) => sum + d.totalPrice, 0),
        occupancy: workingMinutes > 0 ? Math.min(1, bookedMinutes / workingMinutes) : 0,
        appointments: todayDocs.map((d) => toStaffAppointment(d, staffMap, settings, now)),
      },
      week: {
        from: weekStartDate,
        appointments: weekAgg.reduce((sum, w) => sum + w.count, 0),
        completedRevenue: weekCompleted?.revenue ?? 0,
        expectedRevenue: weekAgg.filter((w) => w._id !== 'no_show').reduce((sum, w) => sum + w.revenue, 0),
      },
      pendingApprovals: pendingCount,
      next7Days: next7Count,
      newClientsThisMonth: newClients,
      topServices: topServices.map((t) => ({ id: String(t._id), name: t.name, count: t.count })),
      currency: settings.currency,
    });
  });

  return app;
}
