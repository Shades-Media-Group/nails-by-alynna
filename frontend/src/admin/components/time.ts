/**
 * Calendar math in the studio's time zone for staff screens: a port of backend/src/lib/time.ts,
 * so a time typed at the desk means the same instant to the API, whatever the device's zone.
 * Dates are calendar strings (YYYY-MM-DD); times are wall-clock strings (HH:mm).
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
    });
    formatters.set(timeZone, f);
  }
  return f;
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
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +180 for EEST). */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = rawParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date, wall-clock time and minutes since midnight of an instant. */
export function zonedParts(instant: Date | string, timeZone: string): { date: string; time: string; minutes: number } {
  const p = rawParts(new Date(instant), timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}`, minutes: p.hour * 60 + p.minute };
}

/**
 * The instant of a wall-clock time in `timeZone`. A time skipped by the spring-forward change
 * resolves to just after the gap; an ambiguous autumn time resolves to one valid occurrence.
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
    if (zonedParts(new Date(candidate), timeZone).time === time) result = candidate;
    else result = Math.max(result, candidate);
  }
  return new Date(result);
}

export function timeToMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export const isDate = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const isTime = (value: string | null | undefined): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
