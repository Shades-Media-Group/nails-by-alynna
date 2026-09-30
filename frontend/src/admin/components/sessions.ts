import { isTime, minutesToTime, timeToMinutes } from './time';

/** A session when a master takes one client, in working-days mode, unless they choose otherwise (as the API). */
export const DEFAULT_SESSION_MIN = 120;
/** Session lengths a master can choose (the API takes 30 min–4 h in 15-minute steps). */
export const SESSIONS = [60, 90, 120, 150, 180, 240];
/** Bookings one working day can hold (as the API). */
export const MAX_DAY_BOOKINGS = 12;
/** A new day's times until the master has opened one: three clients, two hours apart from 10:00. */
export const DEFAULT_TIMES = ['10:00', '12:00', '14:00'];

const DAY_MIN = 24 * 60;

/** When a booking starting at `time` ends (HH:mm, at most 24:00). */
export function sessionEnd(time: string, sessionMin: number): string {
  return minutesToTime(Math.min(DAY_MIN, timeToMinutes(time) + sessionMin));
}

/** The next free start after the latest time: a session later, or at the day's last possible start. */
export function nextTime(times: string[], sessionMin: number): string {
  const latest = Math.max(...times.filter(isTime).map(timeToMinutes), 8 * 60 - sessionMin);
  return minutesToTime(Math.min(latest + sessionMin, DAY_MIN - sessionMin));
}

export type TimesIssue = { issue: 'required' } | { issue: 'overlap'; first: string; second: string } | { issue: 'too_late'; time: string };

/**
 * Why a day's start times can't be saved, as the API checks: a missing time, two closer than a
 * session (the first booking would still be going) or a booking running past midnight.
 */
export function timesIssue(times: string[], sessionMin: number): TimesIssue | null {
  if (times.length === 0 || times.some((time) => !isTime(time))) return { issue: 'required' };
  const sorted = [...times].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (timeToMinutes(sorted[i]!) - timeToMinutes(sorted[i - 1]!) < sessionMin) return { issue: 'overlap', first: sorted[i - 1]!, second: sorted[i]! };
  }
  const last = sorted.at(-1)!;
  if (timeToMinutes(last) + sessionMin > DAY_MIN) return { issue: 'too_late', time: last };
  return null;
}
