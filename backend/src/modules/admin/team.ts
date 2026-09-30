import { ObjectId } from 'bson';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import {
  ACTIVE_STATUSES,
  type CalendarProvider,
  type StaffDoc,
  type TimeOffDoc,
  type UserDoc,
  type WeeklyHours,
  type WorkDayDoc,
} from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { enforceRateLimits } from '../../lib/rate-limit';
import { addDays, dayRange, timeToMinutes, toZonedParts, todayIn, zonedTimeToUtc } from '../../lib/time';
import { dateSchema, emailSchema, objectIdSchema, paramId, parseJson, parseQuery, timeSchema } from '../../lib/validation';
import { requireRole } from '../../middleware/auth';
import { appleConnectError, connectAppleCalendar, startGoogleConnect } from '../calendar/connect';
import { feedLinks, newFeedToken } from '../calendar/feed';
import { directCalendarStatus, disconnectCalendar, syncConnection } from '../calendar/sync';
import { opensDays, sessionMinOf } from '../availability/service';
import { getSettings } from '../settings';
import { staffInputSchema, staffPatchSchema } from './schemas';

/** How far ahead a master can open days (staff see a year ahead). */
const WORK_DAYS_AHEAD = 365;
/** Bookings clients can make on one working day, at most. */
const MAX_BOOKINGS_A_DAY = 12;

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
    scheduleMode: s.scheduleMode ?? 'weekly',
    sessionMin: sessionMinOf(s),
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

function toWorkDay(d: WorkDayDoc, booked: number) {
  return {
    id: d._id.toHexString(),
    staffId: d.staffId.toHexString(),
    date: d.date,
    /** HH:mm, in order: when each booking of the day can start. */
    times: d.times,
    /** Bookings on the day, whoever made them (cancelled ones aside). */
    booked,
  };
}

/** Bookings on each master's days (cancelled ones aside), keyed `staffId:date`. */
async function bookedOnDays(deps: AppDeps, days: WorkDayDoc[], timeZone: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (days.length === 0) return counts;
  const dates = days.map((d) => d.date).sort();
  const docs = await deps.col.appointments
    .find(
      {
        staffId: { $in: [...new Set(days.map((d) => d.staffId.toHexString()))].map((id) => new ObjectId(id)) },
        status: { $ne: 'cancelled' },
        start: { $gte: dayRange(dates[0]!, timeZone).start, $lt: dayRange(dates.at(-1)!, timeZone).end },
      },
      { projection: { staffId: 1, start: 1 } },
    )
    .toArray();
  for (const doc of docs) {
    const key = `${doc.staffId.toHexString()}:${toZonedParts(doc.start, timeZone).date}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Whether a booking sits inside one stretch of the weekly hours (Monday first), in the studio's zone. */
function coveredByWeek(weekly: WeeklyHours, start: Date, end: Date, timeZone: string): boolean {
  const from = toZonedParts(start, timeZone);
  const to = toZonedParts(end, timeZone);
  const endMinutes = to.date === from.date ? to.minutes : to.date === addDays(from.date, 1) && to.minutes === 0 ? 24 * 60 : -1;
  if (endMinutes < 0) return false;
  return (weekly[from.weekday - 1] ?? []).some((i) => timeToMinutes(i.start) <= from.minutes && endMinutes <= timeToMinutes(i.end));
}

/**
 * Whether a booking sits inside a day the master opened (working-days mode), in the studio's zone:
 * from its first start time to the end of its last booking.
 */
function coveredByDay(days: Map<string, WorkDayDoc>, sessionMin: number, start: Date, end: Date, timeZone: string): boolean {
  const from = toZonedParts(start, timeZone);
  const to = toZonedParts(end, timeZone);
  const times = days.get(from.date)?.times ?? [];
  if (times.length === 0) return false;
  const endMinutes = to.date === from.date ? to.minutes : to.date === addDays(from.date, 1) && to.minutes === 0 ? 24 * 60 : -1;
  return timeToMinutes(times[0]!) <= from.minutes && endMinutes >= 0 && endMinutes <= timeToMinutes(times.at(-1)!) + Math.max(sessionMin, to.minutes - from.minutes);
}

/**
 * The start times of a working day, in order, or why they can't be: two closer than a session
 * (the first booking would still be going), or a booking running past midnight.
 */
export function workDayTimesIssue(times: string[], sessionMin: number): 'overlap' | 'too_late' | null {
  const minutes = times.map(timeToMinutes);
  if (minutes.some((m, i) => i > 0 && m - minutes[i - 1]! < sessionMin)) return 'overlap';
  if (minutes.at(-1)! + sessionMin > 24 * 60) return 'too_late';
  return null;
}

/**
 * Upcoming bookings of a master that their hours no longer cover (new weekly hours, or a day
 * closed or shortened in working-days mode): they stay booked, and the master is told.
 */
async function bookingsOutsideHours(deps: AppDeps, staff: StaffDoc, timeZone: string) {
  const upcoming = await deps.col.appointments
    .find(
      { staffId: staff._id, status: { $in: ACTIVE_STATUSES }, start: { $gte: deps.now() } },
      { sort: { start: 1 }, limit: 300, projection: { start: 1, end: 1, client: 1 } },
    )
    .toArray();
  let covered = (a: { start: Date; end: Date }) => coveredByWeek(staff.weekly, a.start, a.end, timeZone);
  if (opensDays(staff)) {
    const dates = [...new Set(upcoming.map((a) => toZonedParts(a.start, timeZone).date))];
    const days = await deps.col.workDays.find({ staffId: staff._id, date: { $in: dates } }).toArray();
    const byDate = new Map(days.map((d) => [d.date, d]));
    covered = (a) => coveredByDay(byDate, sessionMinOf(staff), a.start, a.end, timeZone);
  }
  return upcoming
    .filter((a) => !covered(a))
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

  const ownWeekSchema = staffPatchSchema.pick({ weekly: true, bufferMin: true, scheduleMode: true, sessionMin: true });

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

  // ── Calendar sync: Google Calendar and iCloud connected directly (instant), and the private
  // feed Apple Calendar, Google Calendar and Outlook subscribe to (they refresh it themselves) ──
  const calendarResponse = async (staff: StaffDoc) => ({
    feed: feedLinks(deps, staff, (await getSettings(deps)).name),
    ...(await directCalendarStatus(deps, staff._id)),
  });

  app.get('/me/calendar', async (c) => c.json(await calendarResponse(await ownProfile(c))));

  /** Turns sync on, or gives a new link: calendars subscribed to the old one stop getting updates. */
  app.post('/me/calendar', async (c) => {
    const actor = c.get('user');
    const profile = await ownProfile(c);
    const calendarFeed = { token: newFeedToken(), createdAt: deps.now() };
    await deps.col.staff.updateOne({ _id: profile._id }, { $set: { calendarFeed, updatedAt: deps.now() } });
    await audit(deps, {
      actorId: actor._id,
      action: profile.calendarFeed ? 'calendar_feed.reset' : 'calendar_feed.create',
      targetType: 'staff',
      targetId: profile._id,
    });
    return c.json(await calendarResponse({ ...profile, calendarFeed }), 201);
  });

  /** Turns sync off: the link stops working, and subscribed calendars keep only what they had. */
  app.delete('/me/calendar', async (c) => {
    const actor = c.get('user');
    const profile = await ownProfile(c);
    await deps.col.staff.updateOne({ _id: profile._id }, { $set: { calendarFeed: null, updatedAt: deps.now() } });
    await audit(deps, { actorId: actor._id, action: 'calendar_feed.delete', targetType: 'staff', targetId: profile._id });
    return c.json(await calendarResponse({ ...profile, calendarFeed: null }));
  });

  /**
   * Google Calendar: the address of Google's consent screen. The app goes there; Google comes
   * back to /api/auth/google/callback, which connects the calendar and opens My schedule again.
   */
  app.post('/me/calendar/google', async (c) => {
    const actor = c.get('user');
    const profile = await ownProfile(c);
    await enforceRateLimits(deps, [{ key: `calendar:google:user:${actor._id.toHexString()}`, limit: 20, windowSec: 3600 }]);
    return c.json({ url: await startGoogleConnect(deps, c, actor, profile) });
  });

  const appleSchema = z.object({
    appleId: emailSchema,
    /** Apple shows it in groups of four; spaces are not part of it. */
    password: z
      .string()
      .trim()
      .min(1, 'required')
      .max(64, 'too_long')
      .transform((v) => v.replace(/\s+/g, '')),
  });

  /** Apple Calendar (iCloud): checked with Apple at once, so a wrong password is said right away. */
  app.post('/me/calendar/apple', async (c) => {
    const actor = c.get('user');
    const profile = await ownProfile(c);
    // Each try reaches Apple with the password: few, so this can't be used to guess one.
    await enforceRateLimits(deps, [{ key: `calendar:apple:user:${actor._id.toHexString()}`, limit: 10, windowSec: 3600 }]);
    const input = await parseJson(c, appleSchema);
    try {
      await connectAppleCalendar(deps, actor, profile, { appleId: input.appleId, password: input.password });
    } catch (error) {
      throw appleConnectError(error);
    }
    return c.json(await calendarResponse(profile), 201);
  });

  /** Disconnects: the saved sign-in is wiped, and the studio's calendar is deleted in the account. */
  const disconnect = (provider: CalendarProvider) => async (c: Context<AppEnv>) => {
    const actor = c.get('user');
    const profile = await ownProfile(c);
    if (await disconnectCalendar(deps, profile._id, provider)) {
      await audit(deps, { actorId: actor._id, action: `calendar_sync.${provider}_disconnect`, targetType: 'staff', targetId: profile._id });
    }
    return c.json(await calendarResponse(profile));
  };
  app.delete('/me/calendar/google', disconnect('google'));
  app.delete('/me/calendar/apple', disconnect('apple'));

  /** Sync now: every booking written again to the connected calendars, in the background. */
  app.post('/me/calendar/sync', async (c) => {
    const actor = c.get('user');
    const profile = await ownProfile(c);
    await enforceRateLimits(deps, [{ key: `calendar:sync:user:${actor._id.toHexString()}`, limit: 30, windowSec: 3600 }]);
    const connections = await deps.col.calendarConnections.find({ staffId: profile._id, status: 'active' }, { projection: { _id: 1 } }).toArray();
    for (const conn of connections) deps.defer(syncConnection(deps, conn._id, { force: true }));
    return c.json(await calendarResponse(profile));
  });

  // ── Working days: a master in working-days mode opens the days clients can book ──
  /** A master plans their own days; the owner plans anyone's. */
  const mayPlan = (actor: UserDoc, staff: StaffDoc) => actor.role === 'administrator' || Boolean(staff.userId?.equals(actor._id));

  app.get('/work-days', async (c) => {
    const settings = await getSettings(deps);
    const q = parseQuery(c, z.object({ from: dateSchema, to: dateSchema.optional(), staffId: objectIdSchema.optional() }));
    const to = q.to && q.to >= q.from ? q.to : addDays(q.from, 90);
    const docs = await deps.col.workDays
      .find({ date: { $gte: q.from, $lte: to }, ...(q.staffId ? { staffId: q.staffId } : {}) })
      .sort({ date: 1 })
      .limit(1000)
      .toArray();
    const booked = await bookedOnDays(deps, docs, settings.timezone);
    return c.json({ workDays: docs.map((d) => toWorkDay(d, booked.get(`${d.staffId.toHexString()}:${d.date}`) ?? 0)) });
  });

  const workDaysSchema = z
    .object({
      staffId: objectIdSchema,
      /** The same start times on every date. */
      dates: z.array(dateSchema).min(1, 'required').max(62, 'too_many'),
      /** When each booking of the day can start: one client each. */
      times: z.array(timeSchema).min(1, 'required').max(MAX_BOOKINGS_A_DAY, 'too_many'),
    })
    .transform((v) => ({ ...v, times: [...new Set(v.times)].sort() }));

  /** Opens days (or changes days already open) with the same start times. */
  app.put('/work-days', async (c) => {
    const actor = c.get('user');
    const settings = await getSettings(deps);
    const input = await parseJson(c, workDaysSchema);
    const staff = await deps.col.staff.findOne({ _id: input.staffId, isActive: true });
    if (!staff) throw new AppError(422, 'VALIDATION_ERROR', 'Unknown master', { fields: { staffId: 'invalid' } });
    if (!mayPlan(actor, staff)) throw new AppError(403, 'FORBIDDEN', 'Only the master or the owner can open their days');
    const today = todayIn(settings.timezone, deps.now());
    const dates = [...new Set(input.dates)].sort();
    if (dates[0]! < today) throw new AppError(422, 'VALIDATION_ERROR', 'Past day', { fields: { dates: 'past' } });
    if (dates.at(-1)! > addDays(today, WORK_DAYS_AHEAD)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Too far ahead', { fields: { dates: 'too_far' } });
    }
    const issue = workDayTimesIssue(input.times, sessionMinOf(staff));
    if (issue) throw new AppError(422, 'VALIDATION_ERROR', 'Times do not fit', { fields: { times: issue } });

    const now = deps.now();
    for (const date of dates) {
      await deps.col.workDays.updateOne(
        { staffId: staff._id, date },
        {
          $set: { times: input.times, updatedAt: now },
          $setOnInsert: { _id: new ObjectId(), staffId: staff._id, date, createdBy: actor._id, createdAt: now },
        },
        { upsert: true },
      );
    }
    await audit(deps, { actorId: actor._id, action: 'work_days.save', targetType: 'staff', targetId: staff._id, meta: { dates } });
    const saved = await deps.col.workDays.find({ staffId: staff._id, date: { $in: dates } }).sort({ date: 1 }).toArray();
    const booked = await bookedOnDays(deps, saved, settings.timezone);
    return c.json({
      workDays: saved.map((d) => toWorkDay(d, booked.get(`${d.staffId.toHexString()}:${d.date}`) ?? 0)),
      outsideHours: opensDays(staff) ? await bookingsOutsideHours(deps, staff, settings.timezone) : [],
    });
  });

  /** Closes a day again; its bookings stay booked, and the master is told which. */
  app.delete('/work-days/:id', async (c) => {
    const actor = c.get('user');
    const id = paramId(c);
    const day = await deps.col.workDays.findOne({ _id: id });
    if (!day) throw notFound('Working day');
    const staff = await deps.col.staff.findOne({ _id: day.staffId });
    if (!staff || !mayPlan(actor, staff)) throw new AppError(403, 'FORBIDDEN', 'Only the master or the owner can close their days');
    await deps.col.workDays.deleteOne({ _id: id });
    await audit(deps, { actorId: actor._id, action: 'work_days.delete', targetType: 'staff', targetId: staff._id, meta: { date: day.date } });
    const settings = await getSettings(deps);
    return c.json({ ok: true, outsideHours: opensDays(staff) ? await bookingsOutsideHours(deps, staff, settings.timezone) : [] });
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
