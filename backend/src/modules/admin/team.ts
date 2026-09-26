import { ObjectId } from 'bson';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES, type StaffDoc, type TimeOffDoc, type WeeklyHours } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { addDays, dayRange, timeToMinutes, toZonedParts, zonedTimeToUtc } from '../../lib/time';
import { dateSchema, objectIdSchema, paramId, parseJson, parseQuery, timeSchema } from '../../lib/validation';
import { requireRole } from '../../middleware/auth';
import { getSettings } from '../settings';
import { staffInputSchema, staffPatchSchema } from './schemas';

function toStaff(s: StaffDoc) {
  return {
    id: s._id.toHexString(),
    name: s.name,
    title: s.title,
    color: s.color,
    userId: s.userId?.toHexString() ?? null,
    serviceIds: s.serviceIds?.map((id) => id.toHexString()) ?? null,
    weekly: s.weekly,
    bufferMin: s.bufferMin ?? 0,
    isActive: s.isActive,
    isBookable: s.isBookable,
    order: s.order,
  };
}

function toTimeOff(t: TimeOffDoc) {
  return {
    id: t._id.toHexString(),
    staffId: t.staffId?.toHexString() ?? null,
    start: t.start.toISOString(),
    end: t.end.toISOString(),
    reason: t.reason,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Whether a booking sits inside one stretch of the weekly hours (Monday first), in the studio's zone. */
function coveredByWeek(weekly: WeeklyHours, start: Date, end: Date, timeZone: string): boolean {
  const from = toZonedParts(start, timeZone);
  const to = toZonedParts(end, timeZone);
  const endMinutes = to.date === from.date ? to.minutes : to.date === addDays(from.date, 1) && to.minutes === 0 ? 24 * 60 : -1;
  if (endMinutes < 0) return false;
  return (weekly[from.weekday - 1] ?? []).some((i) => timeToMinutes(i.start) <= from.minutes && endMinutes <= timeToMinutes(i.end));
}

/** Upcoming bookings of a master that their new hours no longer cover: they stay booked, and the master is told. */
async function bookingsOutsideHours(deps: AppDeps, staff: StaffDoc, timeZone: string) {
  const upcoming = await deps.col.appointments
    .find(
      { staffId: staff._id, status: { $in: ACTIVE_STATUSES }, start: { $gte: deps.now() } },
      { sort: { start: 1 }, limit: 300, projection: { start: 1, end: 1, client: 1 } },
    )
    .toArray();
  return upcoming
    .filter((a) => !coveredByWeek(staff.weekly, a.start, a.end, timeZone))
    .map((a) => ({
      id: a._id.toHexString(),
      start: a.start.toISOString(),
      end: a.end.toISOString(),
      clientName: `${a.client.name} ${a.client.surname}`.trim(),
    }));
}

export function adminTeamRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const owner = requireRole('administrator');

  // ── Masters ─────────────────────────────────────────────────────────────────
  app.get('/staff', async (c) => {
    const staff = await deps.col.staff.find().sort({ order: 1, _id: 1 }).toArray();
    return c.json({ staff: staff.map(toStaff) });
  });

  app.post('/staff', owner, async (c) => {
    const input = await parseJson(c, staffInputSchema);
    const now = deps.now();
    const last = await deps.col.staff.find().sort({ order: -1 }).limit(1).next();
    const doc: StaffDoc = { _id: new ObjectId(), ...input, order: (last?.order ?? 0) + 1, createdAt: now, updatedAt: now };
    await deps.col.staff.insertOne(doc);
    await audit(deps, { actorId: c.get('user')._id, action: 'staff.create', targetType: 'staff', targetId: doc._id });
    return c.json({ staff: toStaff(doc) }, 201);
  });

  app.patch('/staff/:id', owner, async (c) => {
    const id = paramId(c);
    const input = await parseJson(c, staffPatchSchema);
    const updated = await deps.col.staff.findOneAndUpdate(
      { _id: id },
      { $set: { ...input, updatedAt: deps.now() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('Master');
    await audit(deps, { actorId: c.get('user')._id, action: 'staff.update', targetType: 'staff', targetId: id });
    return c.json({ staff: toStaff(updated) });
  });

  // ── My schedule: a master sets their own week (hours, breaks, time between clients) ──
  const ownProfile = async (c: Context<AppEnv>) => {
    const profile = await deps.col.staff.findOne({ userId: c.get('user')._id, isActive: true });
    if (!profile) throw notFound('Master');
    return profile;
  };

  app.get('/me', async (c) => c.json({ staff: toStaff(await ownProfile(c)) }));

  const ownWeekSchema = staffPatchSchema.pick({ weekly: true, bufferMin: true });

  app.patch('/me', async (c) => {
    const actor = c.get('user');
    const profile = await ownProfile(c);
    const input = await parseJson(c, ownWeekSchema);
    const updated = await deps.col.staff.findOneAndUpdate(
      { _id: profile._id },
      { $set: { ...input, updatedAt: deps.now() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('Master');
    await audit(deps, { actorId: actor._id, action: 'staff.update_own', targetType: 'staff', targetId: profile._id });
    const settings = await getSettings(deps);
    return c.json({ staff: toStaff(updated), outsideHours: await bookingsOutsideHours(deps, updated, settings.timezone) });
  });

  // ── Time off / closures ─────────────────────────────────────────────────────
  app.get('/time-off', async (c) => {
    const settings = await getSettings(deps);
    const q = parseQuery(c, z.object({ from: dateSchema, to: dateSchema.optional() }));
    const start = dayRange(q.from, settings.timezone).start;
    const end = dayRange(q.to && q.to >= q.from ? q.to : addDays(q.from, 90), settings.timezone).end;
    const docs = await deps.col.timeOff
      .find({ start: { $lt: end }, end: { $gt: start } })
      .sort({ start: 1 })
      .limit(500)
      .toArray();
    return c.json({ timeOff: docs.map(toTimeOff) });
  });

  const timeOffSchema = z
    .object({
      staffId: objectIdSchema.nullable(),
      from: dateSchema,
      to: dateSchema,
      startTime: timeSchema.optional(),
      endTime: timeSchema.optional(),
      reason: z.string().trim().max(200, 'too_long').default(''),
    })
    .refine((v) => v.to >= v.from, { message: 'end_before_start', path: ['to'] })
    .refine((v) => Boolean(v.startTime) === Boolean(v.endTime), { message: 'required', path: ['endTime'] });

  app.post('/time-off', async (c) => {
    const actor = c.get('user');
    const settings = await getSettings(deps);
    const input = await parseJson(c, timeOffSchema);
    // Only the administrator may close the whole studio.
    if (input.staffId === null && actor.role !== 'administrator') {
      throw new AppError(403, 'FORBIDDEN', 'Only the administrator can close the studio');
    }
    if (input.staffId) {
      const exists = await deps.col.staff.countDocuments({ _id: input.staffId });
      if (!exists) throw new AppError(422, 'VALIDATION_ERROR', 'Unknown master', { fields: { staffId: 'invalid' } });
    }
    const tz = settings.timezone;
    const start = input.startTime ? zonedTimeToUtc(input.from, input.startTime, tz) : dayRange(input.from, tz).start;
    const end = input.endTime ? zonedTimeToUtc(input.to, input.endTime, tz) : dayRange(input.to, tz).end;
    if (end <= start) {
      throw new AppError(422, 'VALIDATION_ERROR', 'End before start', { fields: { endTime: 'end_before_start' } });
    }
    const doc: TimeOffDoc = {
      _id: new ObjectId(),
      staffId: input.staffId,
      start,
      end,
      reason: input.reason,
      createdBy: actor._id,
      createdAt: deps.now(),
    };
    await deps.col.timeOff.insertOne(doc);
    await audit(deps, { actorId: actor._id, action: 'time_off.create', targetType: 'time_off', targetId: doc._id });
    return c.json({ timeOff: toTimeOff(doc) }, 201);
  });

  app.delete('/time-off/:id', async (c) => {
    const actor = c.get('user');
    const id = paramId(c);
    const doc = await deps.col.timeOff.findOne({ _id: id });
    if (!doc) throw notFound('Time off');
    if (doc.staffId === null && actor.role !== 'administrator') {
      throw new AppError(403, 'FORBIDDEN', 'Only the administrator can reopen the studio');
    }
    await deps.col.timeOff.deleteOne({ _id: id });
    await audit(deps, { actorId: actor._id, action: 'time_off.delete', targetType: 'time_off', targetId: id });
    return c.json({ ok: true });
  });

  return app;
}
