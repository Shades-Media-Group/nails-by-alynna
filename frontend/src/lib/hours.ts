import type { StaffMember } from '@/types/api';

/** ISO weekday (1 = Monday … 7 = Sunday) of an instant in a time zone. */
export function weekdayIn(timeZone: string, instant = new Date()): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[short] ?? 1;
}

/** Studio hours for a weekday: the union of every bookable master's intervals. */
export function studioHours(staff: StaffMember[], weekday: number): { open: string; close: string } | null {
  const intervals = staff.flatMap((s) => s.weekly[weekday - 1] ?? []);
  if (intervals.length === 0) return null;
  const open = intervals.map((i) => i.start).sort()[0]!;
  const close = intervals.map((i) => i.end).sort().at(-1)!;
  return { open, close };
}

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
