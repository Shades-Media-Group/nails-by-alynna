import { ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertWeeklyMastersOnce, openDaysForAll, templateTimes } from '../src/modules/availability/autoOpen';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * Working days that open by themselves from the master's usual week: start times one session
 * apart, as far ahead as clients can book (60 days). Masters who had weekly hours move to them once.
 * Today is Monday 2026-06-01, 09:00 in Chișinău; clients book at least 2 hours ahead.
 */

let ctx: TestContext;
let owner: TestClient;
let alinaId: ObjectId;
let gelId: string;

const WEEK = [
  ...Array.from({ length: 5 }, () => [{ start: '10:00', end: '19:00' }]),
  [{ start: '10:00', end: '14:00' }],
  [],
];
const dayOf = (date: string) => ctx.deps.col.workDays.findOne({ staffId: alinaId, date });
const times = (res: { body: { slots: Array<{ time: string }> } }) => res.body.slots.map((s) => s.time);

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  alinaId = new ObjectId((await owner.get('/api/admin/team/me')).body.staff.id as string);
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
});
afterAll(async () => {
  await ctx.close();
});

describe('start times from the usual week', () => {
  it('are one session apart, each visit ending inside the hours', () => {
    expect(templateTimes([{ start: '10:00', end: '19:00' }], 120)).toEqual(['10:00', '12:00', '14:00', '16:00']);
    expect(templateTimes([{ start: '15:00', end: '19:00' }, { start: '10:00', end: '14:00' }], 120)).toEqual(['10:00', '12:00', '15:00', '17:00']);
    expect(templateTimes([{ start: '10:00', end: '11:30' }], 120)).toEqual([]);
    expect(templateTimes([{ start: '09:30', end: '13:00' }], 90)).toEqual(['09:30', '11:00']);
  });
});

describe('masters on weekly hours', () => {
  it('move to working days once, their usual week opening the days as far as clients can book', async () => {
    await ctx.deps.col.staff.updateOne({ _id: alinaId }, { $set: { scheduleMode: 'weekly', weekly: WEEK, autoOpen: null } });
    await ctx.deps.col.meta.deleteOne({ _id: 'workDaysFromWeekV1' });
    await convertWeeklyMastersOnce(ctx.deps);

    const me = (await owner.get('/api/admin/team/me')).body.staff;
    expect(me).toMatchObject({ scheduleMode: 'days', autoOpen: true, sessionMin: 120 });
    expect((await dayOf('2026-06-02'))?.times).toEqual(['10:00', '12:00', '14:00', '16:00']);
    expect((await dayOf('2026-06-06'))?.times).toEqual(['10:00', '12:00']); // Saturday, shorter
    expect(await dayOf('2026-06-07')).toBeNull(); // Sunday off
    // Up to the booking horizon (60 days), and no further.
    expect(await dayOf('2026-07-31')).not.toBeNull();
    expect(await dayOf('2026-08-03')).toBeNull();

    // Clients book those start times.
    const { client } = await registerClient(ctx);
    expect(times(await client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-02`))).toEqual(['10:00', '12:00', '14:00', '16:00']);

    // Only once: a master who later goes back to weekly hours stays there.
    await ctx.deps.col.staff.updateOne({ _id: alinaId }, { $set: { scheduleMode: 'weekly' } });
    await convertWeeklyMastersOnce(ctx.deps);
    expect((await ctx.deps.col.staff.findOne({ _id: alinaId }))?.scheduleMode).toBe('weekly');
    await ctx.deps.col.staff.updateOne({ _id: alinaId }, { $set: { scheduleMode: 'days' } });
  });

  it('keep a day the master closed closed, and open one more day as each day passes', async () => {
    const tuesday = (await dayOf('2026-06-02'))!;
    expect((await owner.delete(`/api/admin/team/work-days/${tuesday._id.toHexString()}`)).status).toBe(200);
    await openDaysForAll(ctx.deps);
    expect(await dayOf('2026-06-02')).toBeNull();

    ctx.advance(24 * 60 * 60_000); // Tuesday
    expect(await dayOf('2026-08-01')).toBeNull();
    await openDaysForAll(ctx.deps);
    expect((await dayOf('2026-08-01'))?.times).toEqual(['10:00', '12:00']); // a Saturday, 60 days on
    expect(await dayOf('2026-06-02')).toBeNull();
  });

  it('open again from a new usual week, leaving days changed by hand or booked as they are', async () => {
    // Sessions last minutes; the clock moved a day.
    expect((await owner.post('/api/auth/refresh')).status).toBe(200);
    // Wednesday booked at 10:00; Thursday changed by hand.
    const { client } = await registerClient(ctx);
    const booked = await client.post('/api/appointments', { serviceIds: [gelId], start: new Date('2026-06-03T10:00:00+03:00').toISOString() });
    expect(booked.status).toBe(201);
    const saved = await owner.request('PUT', '/api/admin/team/work-days', { staffId: alinaId.toHexString(), dates: ['2026-06-04'], times: ['11:00'] });
    expect(saved.status).toBe(200);

    const week = WEEK.map((day, i) => (i < 5 ? [{ start: '09:00', end: '17:00' }] : day));
    expect((await owner.patch('/api/admin/team/me', { weekly: week })).status).toBe(200);
    expect((await dayOf('2026-06-05'))?.times).toEqual(['09:00', '11:00', '13:00', '15:00']);
    expect((await dayOf('2026-06-03'))?.times).toEqual(['10:00', '12:00', '14:00', '16:00']);
    expect((await dayOf('2026-06-04'))?.times).toEqual(['11:00']);
  });

  it('stop opening when the master switches it off; the open days stay', async () => {
    expect((await owner.post('/api/auth/refresh')).status).toBe(200);
    const off = await owner.patch('/api/admin/team/me', { autoOpen: false });
    expect(off.body.staff.autoOpen).toBe(false);
    ctx.advance(3 * 24 * 60 * 60_000);
    await openDaysForAll(ctx.deps);
    expect(await dayOf('2026-08-04')).toBeNull();
    expect(await dayOf('2026-06-05')).not.toBeNull();

    // On again: from the usual week, straight away.
    expect((await owner.post('/api/auth/refresh')).status).toBe(200);
    const on = await owner.patch('/api/admin/team/me', { autoOpen: true });
    expect(on.body.staff.autoOpen).toBe(true);
    expect(await dayOf('2026-08-04')).not.toBeNull();
  });
});
