import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * Working-days mode: a master opens the days clients can book one by one, each with its hours
 * and how many clients they take; every booking takes a 2-hour session. Today is Monday
 * 2026-06-01, 09:00 in Chișinău (UTC+3); clients book at least 2 hours ahead.
 */

let ctx: TestContext;
let owner: TestClient;
let alinaId: string;
let gel: { id: string; durationMin: number };
let longVisit: string[];
let longMinutes: number;

const times = (res: { body: { slots: Array<{ time: string }> } }) => res.body.slots.map((s) => s.time);
const slots = (who: TestClient, serviceIds: string[], date: string) =>
  who.get(`/api/availability/slots?serviceIds=${serviceIds.join(',')}&date=${date}`);
/** 10:00 on a June 2026 date in Chișinău, as the API writes it. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`).toISOString();

beforeAll(async () => {
  ctx = await createTestContext();
  // The seeded owner is also the studio's first master (Alina), on weekly hours to begin with.
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  alinaId = (await owner.get('/api/admin/team/me')).body.staff.id;
  const catalog = await ctx.client().get('/api/catalog');
  const services = catalog.body.services as Array<{ id: string; slug: string; categoryId: string; durationMin: number }>;
  const found = services.find((s) => s.slug === 'gel-polish')!;
  gel = { id: found.id, durationMin: found.durationMin };
  // A visit longer than one session but not two: gel polish with a service from another category.
  const extra = services.find((s) => s.categoryId !== found.categoryId && found.durationMin + s.durationMin > 120 && found.durationMin + s.durationMin <= 240)!;
  longVisit = [gel.id, extra.id];
  longMinutes = gel.durationMin + extra.durationMin;
});
afterAll(async () => {
  await ctx.close();
});

describe('working days', () => {
  it('starts on weekly hours with 2-hour sessions ready', async () => {
    const me = await owner.get('/api/admin/team/me');
    expect(me.body.staff).toMatchObject({ scheduleMode: 'weekly', sessionMin: 120 });
    expect(gel.durationMin).toBeLessThanOrEqual(120);
    expect(longMinutes).toBeGreaterThan(120);
    expect(longMinutes).toBeLessThanOrEqual(240);
  });

  it('switched on, no day can be booked until the master opens it', async () => {
    const { client } = await registerClient(ctx);
    // Tuesday is inside the weekly hours: bookable before the switch...
    expect(times(await slots(client, [gel.id], '2026-06-02')).length).toBeGreaterThan(0);

    const saved = await owner.patch('/api/admin/team/me', { scheduleMode: 'days' });
    expect(saved.status).toBe(200);
    expect(saved.body.staff).toMatchObject({ scheduleMode: 'days', sessionMin: 120 });

    // ...and closed after it, like every other day.
    expect(times(await slots(client, [gel.id], '2026-06-02'))).toEqual([]);
    const days = await client.get(`/api/availability/days?serviceIds=${gel.id}&days=14`);
    expect(days.body.days.every((d: { slots: number }) => d.slots === 0)).toBe(true);
    // Staff booking at the desk see no free times either (they can still type a time).
    expect(times(await slots(owner, [gel.id], '2026-06-02'))).toEqual([]);
  });

  it('offers the times the master set for the day, one client each', async () => {
    const opened = await owner.request('PUT', '/api/admin/team/work-days', {
      staffId: alinaId,
      dates: ['2026-06-03', '2026-06-04'],
      times: ['16:30', '10:00', '13:00', '13:00'],
    });
    expect(opened.status).toBe(200);
    // In order, each time once.
    expect(opened.body.workDays).toEqual([
      expect.objectContaining({ staffId: alinaId, date: '2026-06-03', times: ['10:00', '13:00', '16:30'], booked: 0 }),
      expect.objectContaining({ date: '2026-06-04', times: ['10:00', '13:00', '16:30'] }),
    ]);

    const { client } = await registerClient(ctx);
    expect(times(await slots(client, [gel.id], '2026-06-03'))).toEqual(['10:00', '13:00', '16:30']);
    // A day that wasn't opened stays closed.
    expect(times(await slots(client, [gel.id], '2026-06-05'))).toEqual([]);
    const days = await client.get(`/api/availability/days?serviceIds=${gel.id}&days=7`);
    const open = (days.body.days as Array<{ date: string; slots: number }>).filter((d) => d.slots > 0).map((d) => d.date);
    expect(open).toEqual(['2026-06-03', '2026-06-04']);
  });

  it('takes one client per time; a longer visit can take the next time too', async () => {
    const first = await registerClient(ctx);
    expect((await first.client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-03', '10:00') })).status).toBe(201);
    const second = await registerClient(ctx);
    expect(times(await slots(second.client, [gel.id], '2026-06-03'))).toEqual(['13:00', '16:30']);
    // Only the times the master set can be booked.
    expect((await second.client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-03', '11:00') })).status).toBe(409);
    expect(times(await slots(second.client, longVisit, '2026-06-04'))).toContain('10:00');
    // When the 10:00 visit runs past 13:00, 13:00 is no longer free for anyone.
    const lengthy = await second.client.post('/api/appointments', { serviceIds: longVisit, start: at('2026-06-04', '10:00') });
    expect(lengthy.status).toBe(201);
    const third = await registerClient(ctx);
    const after = times(await slots(third.client, [gel.id], '2026-06-04'));
    expect(after).toEqual(10 * 60 + longMinutes > 13 * 60 ? ['16:30'] : ['13:00', '16:30']);
  });

  it('keeps bookings back to back, whatever break the master or studio set', async () => {
    // Breaks belong to weekly hours; a session already holds the master's break.
    expect((await owner.patch('/api/admin/team/me', { bufferMin: 15 })).status).toBe(200);
    expect((await owner.patch('/api/admin/settings', { bufferMin: 10 })).status).toBe(200);
    await owner.request('PUT', '/api/admin/team/work-days', { staffId: alinaId, dates: ['2026-06-08'], times: ['10:00', '12:00', '14:00'] });

    const first = await registerClient(ctx);
    const second = await registerClient(ctx);
    expect((await first.client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-08', '10:00') })).status).toBe(201);
    // A 2-hour session ends exactly when the next one starts, and that one stays bookable.
    expect(times(await slots(second.client, [gel.id], '2026-06-08'))).toEqual(['12:00', '14:00']);
    expect((await second.client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-08', '12:00') })).status).toBe(201);

    await owner.patch('/api/admin/settings', { bufferMin: 0 });
    await owner.patch('/api/admin/team/me', { bufferMin: 0 });
  });

  it('closes the day for clients once every time is taken; staff can still book at the desk', async () => {
    const third = await registerClient(ctx);
    expect((await third.client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-08', '14:00') })).status).toBe(201);
    const fourth = await registerClient(ctx);
    expect(times(await slots(fourth.client, [gel.id], '2026-06-08'))).toEqual([]);
    const days = await fourth.client.get(`/api/availability/days?serviceIds=${gel.id}&from=2026-06-08&days=1`);
    expect(days.body.days).toEqual([{ date: '2026-06-08', slots: 0 }]);

    const list = await owner.get('/api/admin/team/work-days?from=2026-06-08&to=2026-06-08');
    expect(list.body.workDays).toEqual([expect.objectContaining({ date: '2026-06-08', times: ['10:00', '12:00', '14:00'], booked: 3 })]);

    // A cancelled booking gives its time back.
    const mine = await third.client.get('/api/appointments?scope=upcoming');
    const booking = (mine.body.appointments as Array<{ id: string }>)[0]!;
    expect((await third.client.post(`/api/appointments/${booking.id}/cancel`, {})).status).toBe(200);
    expect(times(await slots(fourth.client, [gel.id], '2026-06-08'))).toEqual(['14:00']);
  });

  it('gives a time to one client only, when two book it at once', async () => {
    await owner.request('PUT', '/api/admin/team/work-days', { staffId: alinaId, dates: ['2026-06-09'], times: ['10:00'] });
    const a = await registerClient(ctx);
    const b = await registerClient(ctx);
    const results = await Promise.all([
      a.client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-09', '10:00') }),
      b.client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-09', '10:00') }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('lets a client move a booking to another free time of the day', async () => {
    await owner.request('PUT', '/api/admin/team/work-days', { staffId: alinaId, dates: ['2026-06-10'], times: ['10:00', '14:00'] });
    const { client } = await registerClient(ctx);
    const booked = await client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-10', '10:00') });
    expect(booked.status).toBe(201);
    const id = booked.body.appointment.id as string;
    // The client's own booking counts as free when moving it.
    const own = await client.get(`/api/availability/slots?serviceIds=${gel.id}&date=2026-06-10&exclude=${id}`);
    expect(times(own)).toEqual(['10:00', '14:00']);
    const moved = await client.post(`/api/appointments/${id}/reschedule`, { start: at('2026-06-10', '14:00') });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment.start).toBe(at('2026-06-10', '14:00'));
  });

  it('keeps time off: a time it touches is not offered', async () => {
    await owner.request('PUT', '/api/admin/team/work-days', { staffId: alinaId, dates: ['2026-06-11'], times: ['10:00', '12:00', '14:00', '16:00'] });
    const off = await owner.post('/api/admin/team/time-off', { staffId: alinaId, from: '2026-06-11', to: '2026-06-11', startTime: '13:00', endTime: '14:00' });
    expect(off.status).toBe(201);
    const { client } = await registerClient(ctx);
    expect(times(await slots(client, [gel.id], '2026-06-11'))).toEqual(['10:00', '14:00', '16:00']);
  });

  it('follows the session length the master chooses', async () => {
    expect((await owner.patch('/api/admin/team/me', { sessionMin: 90 })).status).toBe(200);
    await owner.request('PUT', '/api/admin/team/work-days', { staffId: alinaId, dates: ['2026-06-12'], times: ['10:00', '11:30', '13:00'] });
    const { client } = await registerClient(ctx);
    expect(times(await slots(client, [gel.id], '2026-06-12'))).toEqual(['10:00', '11:30', '13:00']);
    expect((await owner.patch('/api/admin/team/me', { sessionMin: 100 })).status).toBe(422);
    expect((await owner.patch('/api/admin/team/me', { sessionMin: 120 })).status).toBe(200);
  });

  it('checks what a day can hold', async () => {
    const put = (body: Record<string, unknown>) =>
      owner.request('PUT', '/api/admin/team/work-days', { staffId: alinaId, dates: ['2026-06-12'], times: ['10:00', '12:00'], ...body });
    // Two times closer than a session (2 h): the first booking would still be going.
    expect((await put({ times: ['10:00', '11:00'] })).body.error.fields).toEqual({ times: 'overlap' });
    // The last booking must end by midnight.
    expect((await put({ times: ['23:00'] })).body.error.fields).toEqual({ times: 'too_late' });
    expect((await put({ times: [] })).status).toBe(422);
    expect((await put({ times: ['25:00'] })).status).toBe(422);
    expect((await put({ times: Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, '0')}:00`) })).status).toBe(422);
    // Days before today, or more than a year ahead.
    expect((await put({ dates: ['2026-05-31'] })).body.error.fields).toEqual({ dates: 'past' });
    expect((await put({ dates: ['2027-07-01'] })).body.error.fields).toEqual({ dates: 'too_far' });
    // Saving a day again changes it in place.
    const again = await put({ times: ['12:00', '15:00'] });
    expect(again.status).toBe(200);
    expect(again.body.workDays).toEqual([expect.objectContaining({ date: '2026-06-12', times: ['12:00', '15:00'] })]);
    expect((await owner.get('/api/admin/team/work-days?from=2026-06-12&to=2026-06-12')).body.workDays).toHaveLength(1);
  });

  it('closing a day keeps its bookings, and says which', async () => {
    await owner.request('PUT', '/api/admin/team/work-days', { staffId: alinaId, dates: ['2026-06-15'], times: ['10:00', '12:00'] });
    const { client } = await registerClient(ctx);
    const booked = await client.post('/api/appointments', { serviceIds: [gel.id], start: at('2026-06-15', '12:00') });
    expect(booked.status).toBe(201);
    const day = (await owner.get('/api/admin/team/work-days?from=2026-06-15&to=2026-06-15')).body.workDays[0];
    const closed = await owner.delete(`/api/admin/team/work-days/${day.id}`);
    expect(closed.status).toBe(200);
    expect(closed.body.outsideHours).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: booked.body.appointment.id, start: at('2026-06-15', '12:00') })]),
    );
    expect(times(await slots(client, [gel.id], '2026-06-15'))).toEqual([]);
  });

  it('shows the opened days in the studio hours, from the first time to the end of the last booking', async () => {
    const staff = await ctx.client().get('/api/staff');
    const alina = (staff.body.staff as Array<{ id: string; scheduleMode: string; days: Array<{ date: string; start: string; end: string }> }>).find(
      (s) => s.id === alinaId,
    )!;
    expect(alina.scheduleMode).toBe('days');
    expect(alina.days.map((d) => d.date)).toEqual(['2026-06-03', '2026-06-04', '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12']);
    expect(alina.days[0]).toEqual({ date: '2026-06-03', start: '10:00', end: '18:30' });
  });

  it('only the master or the owner opens a master’s days', async () => {
    const { client, user } = await registerClient(ctx);
    const body = { staffId: alinaId, dates: ['2026-06-16'], times: ['10:00'] };
    expect((await client.request('PUT', '/api/admin/team/work-days', body)).status).toBe(403);
    // Reception (staff without a master profile) can read the days but not open them.
    expect((await owner.patch(`/api/admin/users/${user.id}`, { role: 'admin' })).status).toBe(200);
    const reception = await loginAs(ctx, user.email, strongPassword);
    expect((await reception.get('/api/admin/team/work-days?from=2026-06-01')).status).toBe(200);
    expect((await reception.request('PUT', '/api/admin/team/work-days', body)).status).toBe(403);
  });

  it('switched off, the weekly hours apply again', async () => {
    expect((await owner.patch('/api/admin/team/me', { scheduleMode: 'weekly' })).status).toBe(200);
    const { client } = await registerClient(ctx);
    // Friday 5 June was never opened, but is inside the weekly hours.
    expect(times(await slots(client, [gel.id], '2026-06-05')).length).toBeGreaterThan(0);
  });
});
