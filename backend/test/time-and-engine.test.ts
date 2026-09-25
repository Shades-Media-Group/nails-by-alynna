import { describe, expect, it } from 'vitest';
import { computeDaySlots, type Interval } from '../src/modules/availability/engine';
import { addDays, isoWeekday, toZonedParts, tzOffsetMinutes, zonedTimeToUtc } from '../src/lib/time';
import { normalizePhone } from '../src/lib/validation';

const TZ = 'Europe/Chisinau';

describe('time zone math', () => {
  it('uses winter (+2) and summer (+3) offsets', () => {
    expect(tzOffsetMinutes(new Date('2026-01-15T10:00:00Z'), TZ)).toBe(120);
    expect(tzOffsetMinutes(new Date('2026-07-15T10:00:00Z'), TZ)).toBe(180);
    expect(zonedTimeToUtc('2026-01-15', '10:00', TZ).toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(zonedTimeToUtc('2026-07-15', '10:00', TZ).toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });

  it('round-trips every working-hour time across both DST transition days', () => {
    for (const date of ['2026-03-29', '2026-10-25', '2026-06-01', '2026-12-31']) {
      for (let h = 5; h < 23; h++) {
        const time = `${String(h).padStart(2, '0')}:30`;
        const instant = zonedTimeToUtc(date, time, TZ);
        expect(toZonedParts(instant, TZ)).toMatchObject({ date, time });
      }
    }
  });

  it('never returns an instant before the requested wall time in the spring gap', () => {
    for (let m = 0; m < 24 * 60; m += 30) {
      const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const parts = toZonedParts(zonedTimeToUtc('2026-03-29', time, TZ), TZ);
      expect(parts.date).toBe('2026-03-29');
      expect(parts.time >= time).toBe(true);
    }
  });

  it('adds calendar days and reports ISO weekdays', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoWeekday('2026-06-01')).toBe(1); // Monday
    expect(isoWeekday('2026-06-07')).toBe(7); // Sunday
  });
});

describe('phone normalisation', () => {
  it('accepts Moldovan local formats and E.164', () => {
    expect(normalizePhone('069 123 456')).toBe('+37369123456');
    expect(normalizePhone('+373 (69) 12-34-56')).toBe('+37369123456');
    expect(normalizePhone('0037369123456')).toBe('+37369123456');
    expect(normalizePhone('69123456')).toBe('+37369123456');
    expect(normalizePhone('+40 721 234 567')).toBe('+40721234567');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('call me')).toBeNull();
  });
});

describe('slot engine', () => {
  const weekday = [{ start: '10:00', end: '13:00' }];
  const weekly = [weekday, weekday, weekday, weekday, weekday, [], []];
  const base = {
    date: '2026-06-01', // Monday
    timeZone: TZ,
    durationMin: 60,
    stepMin: 30,
    bufferMin: 0,
    earliestStart: 0,
    staff: [{ id: 'a', weekly }],
    appointments: new Map<string, Interval[]>(),
    timeOff: new Map<string, Interval[]>(),
    closures: [] as Interval[],
  };
  const at = (time: string) => zonedTimeToUtc('2026-06-01', time, TZ).getTime();
  const times = (input: typeof base) => computeDaySlots(input).map((s) => s.time);

  it('offers aligned slots that fit before closing', () => {
    expect(times(base)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00']);
  });

  it('is empty on days off', () => {
    expect(times({ ...base, date: '2026-06-06' })).toEqual([]);
  });

  it('respects the minimum notice', () => {
    expect(times({ ...base, earliestStart: at('11:15') })).toEqual(['11:30', '12:00']);
  });

  it('removes slots overlapping appointments, with buffer', () => {
    const appointments = new Map([['a', [{ start: at('11:00'), end: at('12:00') }]]]);
    expect(times({ ...base, appointments })).toEqual(['10:00', '12:00']);
    expect(times({ ...base, appointments, bufferMin: 15 })).toEqual([]);
  });

  it('removes slots during time off and studio closures', () => {
    const timeOff = new Map([['a', [{ start: at('10:00'), end: at('11:00') }]]]);
    expect(times({ ...base, timeOff })).toEqual(['11:00', '11:30', '12:00']);
    expect(times({ ...base, closures: [{ start: at('00:00'), end: at('23:59') }] })).toEqual([]);
  });

  it('merges masters and lists who is free at each time', () => {
    const appointments = new Map([['a', [{ start: at('10:00'), end: at('13:00') }]]]);
    const slots = computeDaySlots({ ...base, staff: [{ id: 'a', weekly }, { id: 'b', weekly }], appointments });
    expect(slots.map((s) => s.staffIds)).toEqual([['b'], ['b'], ['b'], ['b'], ['b']]);
  });
});
