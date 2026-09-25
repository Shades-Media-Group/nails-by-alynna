import { describe, expect, it } from 'vitest';
import { isoWeekday, zonedParts, zonedTimeToUtc } from './time';
import { clientFieldIssues, clientFromSearch, dayIssue, eligibleMasters, fillFromRo, isPlaceholderEmail, relativeTime, weekSummary } from './utils';
import type { AdminStaff } from '../api';

const TZ = 'Europe/Chisinau';

describe('studio time zone', () => {
  it('turns a wall-clock time into the right instant in summer and winter', () => {
    expect(zonedTimeToUtc('2026-09-25', '14:00', TZ).toISOString()).toBe('2026-09-25T11:00:00.000Z');
    expect(zonedTimeToUtc('2026-01-15', '10:00', TZ).toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('round-trips through zonedParts', () => {
    const instant = zonedTimeToUtc('2026-10-24', '23:30', TZ);
    expect(zonedParts(instant, TZ)).toEqual({ date: '2026-10-24', time: '23:30', minutes: 23 * 60 + 30 });
  });

  it('resolves a time skipped by the spring-forward change to just after the gap', () => {
    // 29 March 2026: clocks jump from 03:00 to 04:00 in Chișinău.
    const instant = zonedTimeToUtc('2026-03-29', '03:30', TZ);
    expect(zonedParts(instant, TZ).date).toBe('2026-03-29');
    expect(zonedParts(instant, TZ).time >= '04:00').toBe(true);
  });

  it('numbers weekdays from Monday', () => {
    expect(isoWeekday('2026-09-21')).toBe(1);
    expect(isoWeekday('2026-09-27')).toBe(7);
  });
});

describe('working hours', () => {
  it('accepts separate stretches and flags broken ones', () => {
    expect(dayIssue([])).toBeNull();
    expect(dayIssue([{ start: '10:00', end: '13:00' }, { start: '14:00', end: '19:00' }])).toBeNull();
    expect(dayIssue([{ start: '19:00', end: '10:00' }])).toBe('end_before_start');
    expect(dayIssue([{ start: '10:00', end: '14:00' }, { start: '13:00', end: '19:00' }])).toBe('overlapping');
    expect(dayIssue([{ start: '', end: '19:00' }])).toBe('invalid_time');
  });

  it('summarises a week, merging days with the same hours', () => {
    const weekday = [{ start: '10:00', end: '19:00' }];
    const week = [weekday, weekday, weekday, weekday, weekday, [{ start: '10:00', end: '15:00' }], []];
    expect(weekSummary(week, 'en')).toBe('Mon–Fri 10:00–19:00 · Sat 10:00–15:00');
    expect(weekSummary([[], [], [], [], [], [], []], 'en')).toBe('');
  });
});

describe('masters for a booking', () => {
  const master = (id: string, serviceIds: string[] | null, extra: Partial<AdminStaff> = {}): AdminStaff => ({
    id,
    name: id,
    title: { ro: '', ru: '', en: '' },
    color: 'blush',
    userId: null,
    serviceIds,
    weekly: [],
    isActive: true,
    isBookable: true,
    order: 0,
    ...extra,
  });

  it('keeps bookable masters who do every chosen service', () => {
    const staff = [master('all', null), master('nails', ['a']), master('both', ['a', 'b']), master('off', null, { isBookable: false })];
    expect(eligibleMasters(staff, ['a', 'b']).map((m) => m.id)).toEqual(['all', 'both']);
    expect(eligibleMasters(undefined, ['a'])).toEqual([]);
  });
});

describe('clients at the desk', () => {
  it('asks for a name, a surname and a phone the API can read; email only if given', () => {
    expect(clientFieldIssues({ name: 'Ana', surname: 'Rusu', phone: '069 123 456', email: '' })).toEqual({});
    expect(clientFieldIssues({ name: '', surname: 'Rusu', phone: '12', email: 'nope' })).toEqual({
      name: 'required',
      phone: 'invalid_phone',
      email: 'invalid_email',
    });
    expect(clientFieldIssues({ name: 'Ana', surname: 'Rusu', phone: '', email: '' }, { phoneRequired: false })).toEqual({});
  });

  it('starts a new client from a search that found nobody', () => {
    expect(clientFromSearch('069 123 456')).toMatchObject({ phone: '069 123 456', name: '' });
    expect(clientFromSearch('Ana Maria Rusu')).toMatchObject({ name: 'Ana', surname: 'Maria Rusu' });
    expect(clientFromSearch('ana@example.com')).toMatchObject({ email: 'ana@example.com' });
  });

  it('recognises walk-in placeholder emails', () => {
    expect(isPlaceholderEmail('client+65f0@no-email.invalid')).toBe(true);
    expect(isPlaceholderEmail(null)).toBe(true);
    expect(isPlaceholderEmail('ana@example.com')).toBe(false);
  });
});

describe('texts', () => {
  it('fills empty languages from Romanian', () => {
    expect(fillFromRo({ ro: ' Manichiură ', ru: '', en: 'Manicure' })).toEqual({ ro: 'Manichiură', ru: 'Manichiură', en: 'Manicure' });
  });

  it('says how long ago in the natural unit', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    expect(relativeTime('2026-09-25T11:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-09-24T12:00:00Z', 'en', now)).toBe('yesterday');
    expect(relativeTime('2026-09-25T15:00:00Z', 'en', now)).toBe('in 3 hours');
  });
});
