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
  /** Existing appointments per staff id (buffer applies around these). */
  appointments: Map<string, Interval[]>;
  /** Personal time off per staff id. */
  timeOff: Map<string, Interval[]>;
  /** Whole-studio closures. */
  closures: Interval[];
}

export interface Slot {
  start: string;
  time: string;
  staffIds: string[];
}

export function computeDaySlots(input: EngineInput): Slot[] {
  const weekday = isoWeekday(input.date);
  const duration = input.durationMin * MINUTE;
  const step = Math.max(5, input.stepMin) * MINUTE;
  const buffer = Math.max(0, input.bufferMin) * MINUTE;
  const byStart = new Map<number, string[]>();

  for (const member of input.staff) {
    const intervals = member.weekly[weekday - 1] ?? [];
    const appointments = input.appointments.get(member.id) ?? [];
    const blocked = [...(input.timeOff.get(member.id) ?? []), ...input.closures];

    for (const interval of intervals) {
      const open = zonedTimeToUtc(input.date, interval.start, input.timeZone).getTime();
      const close = zonedTimeToUtc(input.date, interval.end, input.timeZone).getTime();
      for (let start = open; start + duration <= close; start += step) {
        if (start < input.earliestStart) continue;
        const end = start + duration;
        const clashesAppointment = appointments.some(
          (a) => start < a.end + buffer && end + buffer > a.start,
        );
        if (clashesAppointment) continue;
        const clashesBlock = blocked.some((b) => start < b.end && end > b.start);
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
    .map(([start, staffIds]) => ({
      start: new Date(start).toISOString(),
      time: toZonedParts(new Date(start), input.timeZone).time,
      staffIds,
    }));
}

/** True when [start, end) overlaps any interval (with an optional buffer around them). */
export function overlapsAny(start: number, end: number, intervals: Interval[], buffer = 0): boolean {
  return intervals.some((i) => start < i.end + buffer && end + buffer > i.start);
}
