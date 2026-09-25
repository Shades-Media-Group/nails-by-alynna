import { describe, expect, it } from 'vitest';
import { FEW_SMART_TIMES, computeDaySlots, type EngineInput, type Interval } from '../src/modules/availability/engine';
import { minutesToTime, timeToMinutes, zonedTimeToUtc } from '../src/lib/time';

/*
 * Smart slots (engine): clients are offered only start times that leave no dead gap — the free
 * time on each side of the visit is either back to back (≤ maxGapMin) or long enough for another
 * visit (≥ minBookableGapMin) — plus the exact back-to-back times, even off the slot grid.
 */

const TZ = 'Europe/Chisinau';
const DAY = '2026-06-02'; // Tuesday
const SATURDAY = '2026-06-06';
const WORKDAY = [{ start: '10:00', end: '19:00' }];
const weekly = [WORKDAY, WORKDAY, WORKDAY, WORKDAY, WORKDAY, [{ start: '10:00', end: '16:00' }], []];
const SMART = { maxGapMin: 10, minBookableGapMin: 90 };

const at = (time: string, date = DAY) => zonedTimeToUtc(date, time, TZ).getTime();
const visit = (from: string, to: string, date = DAY): Interval => ({ start: at(from, date), end: at(to, date) });
const booked = (...visits: Interval[]) => new Map([['alina', visits]]);

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    date: DAY,
    timeZone: TZ,
    durationMin: 90, // gel polish
    stepMin: 15,
    bufferMin: 0,
    earliestStart: 0,
    staff: [{ id: 'alina', weekly }],
    appointments: new Map(),
    timeOff: new Map(),
    closures: [],
    smart: SMART,
    ...over,
  };
}
const times = (over: Partial<EngineInput> = {}) => computeDaySlots(input(over)).map((s) => s.time);
const slotAt = (time: string, over: Partial<EngineInput> = {}) => computeDaySlots(input(over)).find((s) => s.time === time);
/** "HH:mm" from `from` to `to` inclusive, every `step` minutes. */
function every(from: string, to: string, step = 15): string[] {
  const out: string[] = [];
  for (let m = timeToMinutes(from); m <= timeToMinutes(to); m += step) out.push(minutesToTime(m));
  return out;
}

describe('smart slots on an empty day', () => {
  it('opens at the opening, then only at times that leave the morning and evening bookable', () => {
    // 10:15–11:15 would leave 15–75 minutes before the visit that nobody can book; same at the end.
    expect(times()).toEqual(['10:00', ...every('11:30', '16:00'), '17:30']);
  });

  it('keeps the whole day packable for long visits too', () => {
    expect(times({ durationMin: 120 })).toEqual(['10:00', ...every('11:30', '15:30'), '17:00']);
    // Saturday 10:00–16:00, 3 hours: at opening, split in two gel-sized halves, or up to closing.
    expect(times({ date: SATURDAY, durationMin: 180 })).toEqual(['10:00', '11:30', '13:00']);
  });

  it('ends exactly at closing, even off the slot grid', () => {
    // 110 minutes (gel polish + French): 17:10 ends at 19:00; 17:00 leaves 10 minutes, still fine.
    expect(times({ durationMin: 110 })).toEqual(['10:00', ...every('11:30', '15:30'), '17:00', '17:10']);
  });

  it('offers fewer, better times than the regular grid, never one the grid would refuse', () => {
    const regular = computeDaySlots(input({ smart: null })).map((s) => s.time);
    expect(regular).toEqual(every('10:00', '17:30'));
    expect(times().every((time) => regular.includes(time))).toBe(true);
  });
});

describe('back to back after visits of uneven length', () => {
  it('offers the exact end of the previous visit, even off the 15-minute grid', () => {
    // 10:00–11:50 (110 min): 11:50 is back to back, 12:00 leaves 10 minutes; 12:15–13:15 would
    // leave 25–85 minutes nobody can book.
    const list = times({ appointments: booked(visit('10:00', '11:50')) });
    expect(list).toEqual(['11:50', '12:00', ...every('13:30', '16:00'), '17:30']);
  });

  it('offers 11:45 after a 105-minute visit from 10:00, even on a 30-minute grid', () => {
    const appointments = booked(visit('10:00', '11:45'));
    expect(times({ stepMin: 30, appointments })[0]).toBe('11:45');
    // The regular grid can't: 11:45 isn't on it, so the first time was 12:00.
    expect(computeDaySlots(input({ stepMin: 30, appointments, smart: null }))[0]!.time).toBe('12:00');
  });

  it('chains a day of long, uneven visits without a single gap', () => {
    const visits: Interval[] = [];
    const starts: string[] = [];
    // Gel polish, refill size 1, extensions size 3, gel polish: each client takes the first time.
    for (const minutes of [90, 105, 140, 90]) {
      const first = computeDaySlots(input({ durationMin: minutes, appointments: booked(...visits) }))[0]!;
      starts.push(first.time);
      visits.push({ start: Date.parse(first.start), end: Date.parse(first.start) + minutes * 60_000 });
    }
    expect(starts).toEqual(['10:00', '11:30', '13:15', '15:35']);
  });
});

describe('gaps', () => {
  const afterGel = booked(visit('10:00', '11:30'));

  it('refuses times that would leave a gap nobody can book', () => {
    const list = times({ appointments: afterGel });
    expect(list).toEqual(['11:30', ...every('13:00', '16:00'), '17:30']);
    for (const time of ['11:45', '12:00', '12:15', '12:30', '12:45']) expect(list).not.toContain(time);
  });

  it('tolerates up to maxGapMin of free time beside a visit', () => {
    const appointments = booked(visit('10:00', '11:50'));
    expect(times({ appointments })).toContain('12:00'); // 10 free minutes
    const strict = times({ appointments, smart: { ...SMART, maxGapMin: 5 } });
    expect(strict).toContain('11:50');
    expect(strict).not.toContain('12:00');
  });

  it('never counts a gap shorter than the shortest service as bookable', () => {
    // A master who only does 2-hour work: 90 free minutes before a visit can't take anyone.
    const list = times({ staff: [{ id: 'alina', weekly, shortestServiceMin: 120 }], appointments: afterGel });
    expect(list).not.toContain('13:00');
    expect(list).toContain('13:30');
  });

  it('follows the minimum bookable gap the studio sets', () => {
    const list = times({ appointments: afterGel, smart: { ...SMART, minBookableGapMin: 60 } });
    expect(list).toContain('12:30'); // 60 free minutes now count as bookable
    expect(list).not.toContain('12:15');
  });

  it('does not chain short visits into dead gaps', () => {
    // A 20-minute removal right after 11:30 is fine; at 12:00 it would strand 30 minutes.
    const list = times({ durationMin: 20, appointments: afterGel });
    expect(list[0]).toBe('11:30');
    expect(list).not.toContain('12:00');
    expect(list).toContain('13:00');
  });
});

describe('fallback: a day is never shown as full while the visit fits', () => {
  it('fills a gap from either end when the day has almost nothing else', () => {
    // Only 11:30–13:45 is free: a 90-minute visit leaves 45 minutes whatever the time, so it is
    // offered at either end of the gap, never in the middle.
    const appointments = booked(visit('10:00', '11:30'), visit('13:45', '19:00'));
    expect(times({ appointments })).toEqual(['11:30', '12:15']);
    expect(computeDaySlots(input({ appointments, smart: null })).map((s) => s.time)).toEqual(every('11:30', '12:15'));
  });

  it(`keeps refusing dead gaps while the day has at least ${FEW_SMART_TIMES} clean times`, () => {
    // Same awkward gap, but the afternoon has room: clients are sent there instead.
    const appointments = booked(visit('10:00', '11:30'), visit('13:45', '14:00'));
    expect(times({ appointments })).toEqual(['14:00', '15:30', '15:45', '16:00', '17:30']);
  });

  it('never hides a day the regular grid would offer, and every time it offers fits', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let round = 0; round < 300; round++) {
      // A random day: a few visits laid end to end with random gaps, a random new visit length.
      const visits: Interval[] = [];
      let cursor = 10 * 60 + Math.floor(random() * 8) * 15;
      while (cursor < 18 * 60 && random() < 0.8) {
        const length = [20, 50, 90, 105, 120, 140, 165, 180][Math.floor(random() * 8)]!;
        if (cursor + length > 19 * 60) break;
        visits.push(visit(minutesToTime(cursor), minutesToTime(cursor + length)));
        cursor += length + Math.floor(random() * 10) * 10;
      }
      const over: Partial<EngineInput> = {
        durationMin: [20, 50, 90, 105, 110, 120, 140, 180][Math.floor(random() * 8)]!,
        stepMin: [5, 10, 15, 30][Math.floor(random() * 4)]!,
        appointments: booked(...visits),
        earliestStart: random() < 0.3 ? at(minutesToTime(9 * 60 + Math.floor(random() * 480))) : 0,
      };
      const smart = computeDaySlots(input(over));
      const regular = computeDaySlots(input({ ...over, smart: null }));
      if (regular.length > 0) expect(smart.length, JSON.stringify(over)).toBeGreaterThan(0);
      for (const slot of smart) {
        const start = Date.parse(slot.start);
        const end = start + over.durationMin! * 60_000;
        expect(start).toBeGreaterThanOrEqual(Math.max(at('10:00'), over.earliestStart!));
        expect(end).toBeLessThanOrEqual(at('19:00'));
        expect(visits.some((v) => start < v.end && end > v.start)).toBe(false);
      }
    }
  });
});

describe('several masters', () => {
  const both = [
    { id: 'alina', weekly },
    { id: 'irina', weekly },
  ];

  it('offers a time when any master can take it compactly, the tightest fit first', () => {
    const appointments = new Map([['irina', [visit('10:00', '11:30')]]]);
    const slots = computeDaySlots(input({ staff: both, appointments }));
    const at1130 = slots.find((s) => s.time === '11:30')!;
    expect(at1130.staffIds).toEqual(['irina', 'alina']); // back to back for Irina
    expect(slots.find((s) => s.time === '10:00')!.staffIds).toEqual(['alina']);
    // 11:45 would strand 15 minutes in Irina's day, so only Alina (with the morning before her) takes it.
    expect(slots.find((s) => s.time === '11:45')!.staffIds).toEqual(['alina']);
    // Both free at 13:00: the one left with less free time around the visit comes first.
    expect(slots.find((s) => s.time === '13:00')!.staffIds).toEqual(['irina', 'alina']);
  });

  it('gives a gap that the visit fills exactly to that master', () => {
    const appointments = new Map([['irina', [visit('10:00', '11:30'), visit('13:00', '19:00')]]]);
    expect(slotAt('11:30', { staff: both, appointments })!.staffIds).toEqual(['irina', 'alina']);
  });

  it('keeps the studio order when the fit is the same', () => {
    expect(slotAt('10:00', { staff: both })!.staffIds).toEqual(['alina', 'irina']);
  });
});

describe('time off, breaks, closures and the break after each visit', () => {
  const expected = ['10:00', '11:30', '14:00', '15:30', '15:45', '16:00', '17:30'];

  it('treats time off like a booking: visits line up against it', () => {
    const timeOff = new Map([['alina', [visit('13:00', '14:00')]]]);
    expect(times({ timeOff })).toEqual(expected);
  });

  it('treats a break in the working hours the same way', () => {
    const split = [{ start: '10:00', end: '13:00' }, { start: '14:00', end: '19:00' }];
    expect(times({ staff: [{ id: 'alina', weekly: [split, split, split, split, split, [], []] }] })).toEqual(expected);
  });

  it('offers nothing while the studio is closed', () => {
    expect(times({ closures: [visit('00:00', '23:59')] })).toEqual([]);
    // Open from 16:00: two gel visits back to back, nothing in between.
    expect(times({ closures: [visit('10:00', '16:00')] })).toEqual(['16:00', '17:30']);
  });

  it('counts the break after each visit as part of it', () => {
    // 15-minute break: back to back is 11:45; the next bookable gap needs 90 + 15 minutes.
    const list = times({ bufferMin: 15, appointments: booked(visit('10:00', '11:30')) });
    expect(list).toEqual(['11:45', ...every('13:30', '15:45'), '17:30']);
  });
});

describe('minimum notice (today)', () => {
  it('starts today at the soonest bookable time, then keeps the rest of the day bookable', () => {
    const list = times({ earliestStart: at('11:07') });
    expect(list).toEqual(['11:15', ...every('11:30', '16:00'), '17:30']);
  });

  it('never withdraws an offered time as the clock moves, until it is too soon', () => {
    const schedules = [booked(), booked(visit('12:00', '13:30')), booked(visit('10:00', '11:50'), visit('15:00', '16:45'))];
    for (const appointments of schedules) {
      let previous: string[] = [];
      for (let minute = 9 * 60; minute <= 17 * 60; minute += 5) {
        const earliestStart = at(minutesToTime(minute));
        const now = computeDaySlots(input({ appointments, earliestStart })).map((s) => s.start);
        for (const start of previous) {
          if (Date.parse(start) >= earliestStart) expect(now, `${start} at ${minutesToTime(minute)}`).toContain(start);
        }
        previous = now;
      }
    }
  });
});

describe('switching smart slots off, and staff', () => {
  it('without smart options offers every free time on the grid, exactly as before', () => {
    const appointments = booked(visit('10:00', '11:30'));
    const off = computeDaySlots(input({ appointments, smart: null }));
    const { smart: _omitted, ...withoutSmart } = input({ appointments });
    expect(computeDaySlots(withoutSmart)).toEqual(off);
    expect(off.map((s) => s.time)).toEqual(every('11:30', '17:30'));
  });
});

describe("a master's own break after each client (StaffDoc.bufferMin)", () => {
  const withBreak = (bufferMin: number) => [{ id: 'alina', weekly, bufferMin }];
  const afterGel = booked(visit('10:00', '11:30'));

  it('blocks the time after each of their visits, for staff too', () => {
    const staffList = times({ smart: null, staff: withBreak(15), appointments: afterGel });
    expect(staffList[0]).toBe('11:45');
    expect(times({ smart: null, staff: withBreak(0), appointments: afterGel })[0]).toBe('11:30');
    expect(times({ staff: withBreak(15), appointments: afterGel })[0]).toBe('11:45');
  });

  it('asks a new visit to leave the break free, except when it ends the shift or starts a lunch break', () => {
    // Staff see every free time: 17:15 ends at 18:45 with the break up to 19:00; 17:20 and 17:25
    // would leave no room for it; 17:30 ends exactly at closing.
    const end = times({ smart: null, stepMin: 5, staff: withBreak(15) }).filter((t) => t >= '17:00');
    expect(end).toEqual(['17:00', '17:05', '17:10', '17:15', '17:30']);

    const split = [{ start: '10:00', end: '13:00' }, { start: '14:00', end: '19:00' }];
    const shifts = [{ id: 'alina', weekly: [split, split, split, split, split, [], []], bufferMin: 15 }];
    const morning = times({ smart: null, stepMin: 5, staff: shifts }).filter((t) => t < '13:00');
    expect(morning.slice(-2)).toEqual(['11:15', '11:30']); // 11:30 ends at 13:00, the lunch break

    // Time off isn't the end of a shift: the break is kept before it.
    const timeOff = new Map([['alina', [visit('15:00', '16:00')]]]);
    const beforeTimeOff = times({ smart: null, staff: withBreak(15), timeOff }).filter((t) => t < '15:00');
    expect(beforeTimeOff.at(-1)).toBe('13:15');
  });

  it('counts the break as part of the visit, never as a gap', () => {
    // After 10:00–11:30 and the break, 11:45 is back to back; another gel before the next visit
    // needs 90 minutes plus a break, so 13:30 is the next clean time; 17:15 ends at 18:45 with the
    // break filling the day up to closing, and 17:30 ends exactly at closing.
    expect(times({ staff: withBreak(15), appointments: afterGel })).toEqual(['11:45', ...every('13:30', '15:30'), '17:15', '17:30']);
  });

  it('applies to that master only, and the longer of the studio break and theirs counts', () => {
    const appointments = new Map([
      ['alina', [visit('10:00', '11:30')]],
      ['irina', [visit('10:00', '11:30')]],
    ]);
    const staff = [
      { id: 'alina', weekly, bufferMin: 15 },
      { id: 'irina', weekly },
    ];
    expect(slotAt('11:30', { staff, appointments })!.staffIds).toEqual(['irina']);
    expect(slotAt('11:45', { staff, appointments })!.staffIds).toEqual(['alina']);
    // Studio break 10, Alina's 15: 15 minutes, not 25.
    expect(times({ bufferMin: 10, staff: withBreak(15), appointments: afterGel })[0]).toBe('11:45');
  });
});
