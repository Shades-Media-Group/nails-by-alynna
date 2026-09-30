import { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import { ACTIVE_STATUSES, type StaffDoc, type WeeklyHours, type WorkDayDoc } from '../../db/types';
import { addDays, dayRange, isoWeekday, minutesToTime, timeToMinutes, todayIn } from '../../lib/time';
import { getSettings } from '../settings';
import { sessionMinOf } from './service';

/*
 * Working days that open by themselves. A master in working-days mode with `autoOpen` gets their
 * days opened from their usual week (StaffDoc.weekly): each working interval becomes start times,
 * one session apart (10:00–19:00 with 2 h sessions: 10:00, 12:00, 14:00, 16:00), for as far ahead
 * as clients can book. The master still changes or closes any single day: a day opened here and
 * changed by hand is theirs (`auto` off), and a day closed by hand never comes back, because days
 * open only once, past the last one opened so far (`autoOpen.until`).
 */

/** Start times one session apart inside the day's working intervals, each visit ending in time. */
export function templateTimes(intervals: WeeklyHours[number], sessionMin: number): string[] {
  const times: string[] = [];
  const sorted = [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  for (const interval of sorted) {
    const end = timeToMinutes(interval.end);
    for (let t = timeToMinutes(interval.start); t + sessionMin <= end; t += sessionMin) times.push(minutesToTime(t));
  }
  return times;
}

/** Whether the usual week gives any day a start time (else there is nothing to open). */
export function weekHasTimes(staff: Pick<StaffDoc, 'weekly' | 'sessionMin'>): boolean {
  return staff.weekly.some((day) => templateTimes(day, sessionMinOf(staff)).length > 0);
}

const isDuplicate = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/**
 * Opens this master's days from their usual week, after the last day opened so far and up to
 * `horizonDays` ahead; a day that exists already is left as it is. Returns how many opened.
 */
export async function openDaysFromWeek(deps: AppDeps, staff: StaffDoc, today: string, horizonDays: number): Promise<number> {
  if (staff.scheduleMode !== 'days' || !staff.autoOpen || !staff.isActive) return 0;
  const last = addDays(today, horizonDays);
  const from = staff.autoOpen.until >= today ? addDays(staff.autoOpen.until, 1) : today;
  if (from > last) return 0;

  const existing = new Set(
    (await deps.col.workDays.find({ staffId: staff._id, date: { $gte: from, $lte: last } }, { projection: { date: 1 } }).toArray()).map((d) => d.date),
  );
  const session = sessionMinOf(staff);
  const now = deps.now();
  let opened = 0;
  for (let date = from; date <= last; date = addDays(date, 1)) {
    if (existing.has(date)) continue;
    const times = templateTimes(staff.weekly[isoWeekday(date) - 1] ?? [], session);
    if (times.length === 0) continue;
    const day: WorkDayDoc = { _id: new ObjectId(), staffId: staff._id, date, times, auto: true, createdBy: null, createdAt: now, updatedAt: now };
    try {
      await deps.col.workDays.insertOne(day);
      opened++;
    } catch (error) {
      // Another server opened it at the same moment.
      if (!isDuplicate(error)) throw error;
    }
  }
  await deps.col.staff.updateOne({ _id: staff._id }, { $set: { autoOpen: { until: last } } });
  return opened;
}

/**
 * The usual week or the session length changed (or opening by itself was switched on): days
 * opened here that nobody changed and nobody booked are opened again from the new week. Days the
 * master changed, and days with bookings, stay as they are.
 */
export async function reopenDaysFromWeek(deps: AppDeps, staff: StaffDoc): Promise<number> {
  if (staff.scheduleMode !== 'days' || !staff.autoOpen) return 0;
  const settings = await getSettings(deps);
  const today = todayIn(settings.timezone, deps.now());
  const autoDays = await deps.col.workDays.find({ staffId: staff._id, date: { $gte: today }, auto: true }).toArray();
  if (autoDays.length > 0) {
    const first = dayRange(autoDays.reduce((min, d) => (d.date < min ? d.date : min), autoDays[0]!.date), settings.timezone).start;
    const lastDay = autoDays.reduce((max, d) => (d.date > max ? d.date : max), autoDays[0]!.date);
    const bookings = await deps.col.appointments
      .find(
        { staffId: staff._id, status: { $in: ACTIVE_STATUSES }, start: { $lt: dayRange(lastDay, settings.timezone).end }, end: { $gt: first } },
        { projection: { start: 1, end: 1 } },
      )
      .toArray();
    const busy = (date: string) => {
      const { start, end } = dayRange(date, settings.timezone);
      return bookings.some((b) => b.start < end && b.end > start);
    };
    const free = autoDays.filter((d) => !busy(d.date)).map((d) => d._id);
    if (free.length > 0) await deps.col.workDays.deleteMany({ _id: { $in: free } });
  }
  const fresh = { ...staff, autoOpen: { until: addDays(today, -1) } };
  return openDaysFromWeek(deps, fresh, today, settings.horizonDays);
}

/**
 * Keeps every such master's days open as far ahead as clients can book (from the minute tick and
 * the cron): once a day, a new day at the end of the booking horizon. Never throws.
 */
export async function openDaysForAll(deps: AppDeps): Promise<number> {
  try {
    const settings = await getSettings(deps);
    const today = todayIn(settings.timezone, deps.now());
    const last = addDays(today, settings.horizonDays);
    const due = await deps.col.staff
      .find({ isActive: true, scheduleMode: 'days', autoOpen: { $ne: null }, 'autoOpen.until': { $lt: last } })
      .toArray();
    let opened = 0;
    for (const staff of due) opened += await openDaysFromWeek(deps, staff, today, settings.horizonDays);
    return opened;
  } catch (error) {
    console.error('[work-days] could not open days from the usual week', error);
    return 0;
  }
}

const CONVERTED = 'workDaysFromWeekV1';

/**
 * Once, at start-up: masters who set weekly hours before working days existed move to them, their
 * usual week opening the days by itself, so clients book fixed start times everywhere. Their
 * bookings stay; switching back to weekly hours in My schedule gives the old way back.
 */
export async function convertWeeklyMastersOnce(deps: AppDeps, log: (message: string) => void = () => undefined): Promise<void> {
  if (await deps.col.meta.findOne({ _id: CONVERTED })) return;
  const settings = await getSettings(deps);
  const today = todayIn(settings.timezone, deps.now());
  const masters = await deps.col.staff.find({ isActive: true, scheduleMode: { $ne: 'days' } }).toArray();
  for (const master of masters) {
    if (!weekHasTimes(master)) continue;
    const autoOpen = { until: addDays(today, -1) };
    await deps.col.staff.updateOne({ _id: master._id }, { $set: { scheduleMode: 'days', autoOpen, updatedAt: deps.now() } });
    const opened = await openDaysFromWeek(deps, { ...master, scheduleMode: 'days', autoOpen }, today, settings.horizonDays);
    log(`${master.name}: working days from the usual week, ${opened} days open`);
  }
  await deps.col.meta.updateOne({ _id: CONVERTED }, { $set: { value: true, updatedAt: deps.now() } }, { upsert: true });
}
