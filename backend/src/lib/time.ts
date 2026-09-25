/**
 * Time-zone math without dependencies (Intl only), correct across DST transitions.
 * Dates are calendar strings (YYYY-MM-DD) in the studio's zone; instants are Date (UTC).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface ZonedParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  weekday: number; // 1 = Monday … 7 = Sunday
  minutes: number; // minutes since local midnight
}

function rawParts(instant: Date, timeZone: string) {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday ?? 'Mon'] ?? 1,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +180 for EEST). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = rawParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

export function toZonedParts(instant: Date, timeZone: string): ZonedParts {
  const p = rawParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    weekday: p.weekday,
    minutes: p.hour * 60 + p.minute,
  };
}

/**
 * The UTC instant of a local wall-clock time. Non-existent times (spring-forward gap)
 * resolve to the instant just after the gap; ambiguous times (fall-back) resolve to a
 * valid occurrence of that wall time.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  const offset1 = tzOffsetMinutes(new Date(wallAsUtc), timeZone);
  let result = wallAsUtc - offset1 * 60000;
  const offset2 = tzOffsetMinutes(new Date(result), timeZone);
  if (offset2 !== offset1) {
    const candidate = wallAsUtc - offset2 * 60000;
    // Keep the candidate only if it maps back to the requested wall time.
    if (toZonedParts(new Date(candidate), timeZone).time === time) result = candidate;
    else result = Math.max(result, candidate);
  }
  return new Date(result);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function todayIn(timeZone: string, now: Date): string {
  return toZonedParts(now, timeZone).date;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** UTC range [start, end) covering the whole local calendar day. */
export function dayRange(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(date, '00:00', timeZone),
    end: zonedTimeToUtc(addDays(date, 1), '00:00', timeZone),
  };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
