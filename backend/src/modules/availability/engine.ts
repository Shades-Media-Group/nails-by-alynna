import type { WeeklyHours } from '../../db/types';
import { MINUTE, isoWeekday, toZonedParts, zonedTimeToUtc } from '../../lib/time';

/** Pure slot computation — no I/O, fully unit-tested. Times are epoch milliseconds. */

export interface Interval {
  start: number;
  end: number;
}

export interface EngineStaff {
  id: string;
  weekly: WeeklyHours;
  /**
   * Minutes this master keeps free after every client: their visits block it after their end,
   * and a new visit must leave it free unless it ends exactly at the end of a working interval.
   */
  bufferMin?: number;
  /** Shortest active service this master performs, in minutes: no visit fits a shorter gap. */
  shortestServiceMin?: number;
}

/** Smart slots: only offer start times that keep each master's day compact (see smartDaySlots). */
export interface SmartOptions {
  /** Free minutes next to a visit that still count as back to back. */
  maxGapMin: number;
  /** A free gap at least this long can still take another visit (never less than the master's shortest service). */
  minBookableGapMin: number;
}

export interface EngineInput {
  date: string;
  timeZone: string;
  durationMin: number;
  stepMin: number;
  bufferMin: number;
  /** No slot may start before this instant (now + minimum notice). */
  earliestStart: number;
  staff: EngineStaff[];
  /** Existing appointments per staff id (the studio's and the master's break apply around these). */
  appointments: Map<string, Interval[]>;
  /** Personal time off per staff id. */
  timeOff: Map<string, Interval[]>;
  /** Whole-studio closures. */
  closures: Interval[];
  /** Offer only the compact start times; omit for every free time on the slot grid. */
  smart?: SmartOptions | null;
}

export interface Slot {
  start: string;
  time: string;
  /** Masters who can take this time; with smart slots, the tightest fit first. */
  staffIds: string[];
}

export function computeDaySlots(input: EngineInput): Slot[] {
  return input.smart ? smartDaySlots(input, input.smart) : everyFreeSlot(input);
}

/**
 * The master's own break after a visit, and the free time needed between two of their visits
 * (the studio's break or the master's, whichever is longer).
 */
function breaks(member: EngineStaff, studioBuffer: number) {
  const own = Math.max(0, member.bufferMin ?? 0) * MINUTE;
  return { own, between: Math.max(studioBuffer, own) };
}

/** Every start time on the slot grid (counted from each opening) where the visit fits. */
function everyFreeSlot(input: EngineInput): Slot[] {
  const weekday = isoWeekday(input.date);
  const duration = input.durationMin * MINUTE;
  const step = Math.max(5, input.stepMin) * MINUTE;
  const buffer = Math.max(0, input.bufferMin) * MINUTE;
  const byStart = new Map<number, string[]>();

  for (const member of input.staff) {
    const intervals = member.weekly[weekday - 1] ?? [];
    const appointments = input.appointments.get(member.id) ?? [];
    const blocked = [...(input.timeOff.get(member.id) ?? []), ...input.closures];
    const { own, between } = breaks(member, buffer);

    for (const interval of intervals) {
      const open = zonedTimeToUtc(input.date, interval.start, input.timeZone).getTime();
      const close = zonedTimeToUtc(input.date, interval.end, input.timeZone).getTime();
      for (let start = open; start + duration <= close; start += step) {
        if (start < input.earliestStart) continue;
        const end = start + duration;
        // The master's break after this visit, unless it ends the shift (or starts a lunch break).
        const keep = end === close ? 0 : own;
        if (end + keep > close) continue;
        const clashesAppointment = appointments.some(
          (a) => start < a.end + between && end + between > a.start,
        );
        if (clashesAppointment) continue;
        const clashesBlock = blocked.some((b) => start < b.end && end + keep > b.start);
        if (clashesBlock) continue;
        const list = byStart.get(start);
        if (list) {
          if (!list.includes(member.id)) list.push(member.id);
        } else {
          byStart.set(start, [member.id]);
        }
      }
    }
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, staffIds]) => toSlot(start, staffIds, input.timeZone));
}

/**
 * With fewer smart start times than this in a day, times that fill a free stretch from one end
 * are offered too, even when what is left of it is too short for another visit.
 */
export const FEW_SMART_TIMES = 3;

/** One way to seat the visit: a start time with one master, and how well it fits there. */
interface Placement {
  start: number;
  /** Position in `input.staff` (the studio's order breaks ties). */
  staff: number;
  /** Leaves no dead gap: each side is back to back or long enough for another visit. */
  clean: boolean;
  /** Back to back with the start or the end of its free stretch. */
  touching: boolean;
  /** Sides that are back to back (0–2). */
  tight: number;
  /** Free minutes left on the other sides: less is a tighter fit. */
  rest: number;
  /** Free minutes on the back-to-back sides. */
  slack: number;
}

/**
 * Smart slots, for clients booking online. A master's working hours minus bookings (with the
 * breaks around them), time off and closures leave free stretches. A start time is offered when
 * the visit leaves no dead gap in its stretch: the free time left before it and after it is each
 * either back to back (at most `maxGapMin`) or long enough for another visit (`minBookableGapMin`,
 * never less than the master's shortest service). A master's own break after each client counts
 * as part of the visit, never as a gap. Today, the time before the soonest bookable moment is
 * gone anyway, so starting then counts as back to back.
 *
 * Back-to-back times are always candidates, even off the slot grid: the exact start and end of
 * every stretch (11:50 after a 110-minute visit from 10:00; 17:10 for 110 minutes before a 19:00
 * closing). Other candidates come from the grid. An empty 10:00–19:00 day for a 90-minute visit
 * so offers 10:00, then 11:30 onwards, then 17:30 — never 10:15–11:15 or 16:15–17:15, which
 * would leave an hour or less that nobody can book.
 *
 * Fallback, so a day is never shown as full while the visit fits: when it has fewer than
 * FEW_SMART_TIMES such times, the times that fill a free stretch from either end are offered too,
 * even if the rest of that stretch is too short for another visit — it at least stays in one piece.
 *
 * `staffIds` lists the masters for whom the time fits, the tightest fit first: no dead gap, then
 * a visit that closes a gap on both sides, then the one leaving the least free time around it.
 */
function smartDaySlots(input: EngineInput, smart: SmartOptions): Slot[] {
  const weekday = isoWeekday(input.date);
  const duration = input.durationMin * MINUTE;
  const step = Math.max(5, input.stepMin) * MINUTE;
  const buffer = Math.max(0, input.bufferMin) * MINUTE;
  const maxGap = Math.max(0, smart.maxGapMin) * MINUTE;
  const placements: Placement[] = [];

  input.staff.forEach((member, staffIndex) => {
    const { own, between } = breaks(member, buffer);
    // Another visit beside this one needs its own length plus the break between the two.
    const bookable = Math.max(0, smart.minBookableGapMin, member.shortestServiceMin ?? 0) * MINUTE + between;
    const busy: Busy[] = [
      ...(input.appointments.get(member.id) ?? []).map((a) => ({ start: a.start - between, end: a.end + between, visit: true })),
      ...[...(input.timeOff.get(member.id) ?? []), ...input.closures].map((b) => ({ ...b, visit: false })),
    ];

    for (const interval of member.weekly[weekday - 1] ?? []) {
      const open = zonedTimeToUtc(input.date, interval.start, input.timeZone).getTime();
      const close = zonedTimeToUtc(input.date, interval.end, input.timeZone).getTime();
      /** First time on the slot grid (counted from opening) at or after `t`. */
      const gridFrom = (t: number) => open + Math.ceil(Math.max(0, t - open) / step) * step;

      for (const stretch of freeStretches(open, close, busy)) {
        // The visit and the master's break after it must fit; before another visit that break is
        // already in the stretch. Ending exactly at closing (or a lunch break) needs no break.
        const last = stretch.end - (stretch.endsAtVisit ? 0 : own) - duration;
        const atClose = stretch.end === close && own > 0 ? close - duration : null;
        const first = Math.max(stretch.start, input.earliestStart);
        if (last < first && (atClose === null || atClose < first)) continue;
        // Today the stretch may begin too soon to book; its first bookable time is a start too.
        const soonest = stretch.start < input.earliestStart ? gridFrom(input.earliestStart) : null;

        const starts = new Set<number>();
        for (let t = gridFrom(first); t <= last; t += step) starts.add(t);
        if (last >= first) {
          if (stretch.start >= first) starts.add(stretch.start);
          starts.add(last);
        }
        if (atClose !== null && atClose >= first) starts.add(atClose);

        for (const start of starts) {
          const before = start - stretch.start;
          const after = start === atClose ? 0 : last - start;
          const startSlack = soonest !== null && start >= soonest ? Math.min(before, start - soonest) : before;
          const touchStart = startSlack <= maxGap;
          const touchEnd = after <= maxGap;
          const clean = (touchStart || before >= bookable) && (touchEnd || after >= bookable);
          if (!clean && !touchStart && !touchEnd) continue;
          placements.push({
            start,
            staff: staffIndex,
            clean,
            touching: touchStart || touchEnd,
            tight: Number(touchStart) + Number(touchEnd),
            rest: (touchStart ? 0 : before) + (touchEnd ? 0 : after),
            slack: (touchStart ? startSlack : 0) + (touchEnd ? after : 0),
          });
        }
      }
    }
  });

  const cleanStarts = new Set(placements.filter((p) => p.clean).map((p) => p.start));
  const fallback = cleanStarts.size < FEW_SMART_TIMES;
  const byStart = new Map<number, Placement[]>();
  for (const placement of placements) {
    if (!placement.clean && !(fallback && placement.touching)) continue;
    const list = byStart.get(placement.start);
    if (list) list.push(placement);
    else byStart.set(placement.start, [placement]);
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, list]) => {
      const ids = list.sort(tighterFirst).map((p) => input.staff[p.staff]!.id);
      return toSlot(start, [...new Set(ids)], input.timeZone);
    });
}

function tighterFirst(a: Placement, b: Placement): number {
  return (
    Number(b.clean) - Number(a.clean) ||
    b.tight - a.tight ||
    a.rest - b.rest ||
    a.slack - b.slack ||
    a.staff - b.staff
  );
}

/** Busy time: a visit with the breaks around it, or time off / a closure. */
interface Busy extends Interval {
  visit: boolean;
}

/** A free stretch; `endsAtVisit` when the next visit (its break included) ends it. */
interface Stretch extends Interval {
  endsAtVisit: boolean;
}

/** [open, close) minus the busy intervals, as the free stretches left, in order. */
function freeStretches(open: number, close: number, busy: Busy[]): Stretch[] {
  const blocks = busy.filter((b) => b.start < close && b.end > open).sort((a, b) => a.start - b.start);
  const stretches: Stretch[] = [];
  let cursor = open;
  for (const block of blocks) {
    if (block.start > cursor) {
      // Time off starting at the same moment as a visit still asks for the master's break.
      const endsAtVisit = blocks.every((b) => b.start !== block.start || b.visit);
      stretches.push({ start: cursor, end: block.start, endsAtVisit });
    }
    cursor = Math.max(cursor, block.end);
    if (cursor >= close) return stretches;
  }
  stretches.push({ start: cursor, end: close, endsAtVisit: false });
  return stretches;
}

function toSlot(start: number, staffIds: string[], timeZone: string): Slot {
  return { start: new Date(start).toISOString(), time: toZonedParts(new Date(start), timeZone).time, staffIds };
}

/** True when [start, end) overlaps any interval (with an optional buffer around them). */
export function overlapsAny(start: number, end: number, intervals: Interval[], buffer = 0): boolean {
  return intervals.some((i) => start < i.end + buffer && end + buffer > i.start);
}
