import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateSettingsCache } from '../src/modules/settings';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

let ctx: TestContext;
let owner: TestClient;
let gelId: string;

type Slot = { start: string; time: string; staffIds: string[] };

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  ctx.setNow(new Date('2026-06-01T06:00:00Z')); // Mon 09:00 in Chișinău
  await owner.post('/api/auth/refresh');
  await ctx.deps.col.appointments.deleteMany({});
  await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $set: { leadTimeMin: 120 } }, { upsert: true });
  invalidateSettingsCache(ctx.deps);
});

const slotsFor = async (who: TestClient, date: string, extra = '') => {
  const res = await who.get(`/api/availability/slots?serviceIds=${gelId}&date=${date}${extra}`);
  expect(res.status).toBe(200);
  return res.body.slots as Slot[];
};

describe('availability for staff', () => {
  it('ignores the client lead time and horizon for staff', async () => {
    const { client } = await registerClient(ctx);
    const clientTimes = (await slotsFor(client, '2026-06-01')).map((s) => s.time);
    const staffTimes = (await slotsFor(owner, '2026-06-01')).map((s) => s.time);
    // Clients wait out the 2-hour lead time; staff can book the next free time.
    expect(clientTimes.every((time) => time >= '11:00')).toBe(true);
    expect(staffTimes.some((time) => time < '11:00')).toBe(true);
    // Beyond the client horizon (60 days) staff still see free times.
    expect(await slotsFor(client, '2026-09-01')).toEqual([]);
    expect((await slotsFor(owner, '2026-09-01')).length).toBeGreaterThan(0);
  });

  it("counts a booking's own time as free while moving it, for its owner only", async () => {
    const { client } = await registerClient(ctx);
    const first = (await slotsFor(client, '2026-06-02'))[0]!;
    const booked = await client.post('/api/appointments', { serviceIds: [gelId], start: first.start });
    expect(booked.status).toBe(201);
    const id = booked.body.appointment.id as string;

    expect((await slotsFor(client, '2026-06-02')).some((s) => s.start === first.start)).toBe(false);
    expect((await slotsFor(client, '2026-06-02', `&exclude=${id}`)).some((s) => s.start === first.start)).toBe(true);
    // Somebody else's booking can't be made to look free.
    const { client: other } = await registerClient(ctx);
    expect((await slotsFor(other, '2026-06-02', `&exclude=${id}`)).some((s) => s.start === first.start)).toBe(false);
  });

  it('gives "any master" at a typed time to a master who is free then', async () => {
    const staff = await owner.get('/api/admin/team/staff');
    const firstMaster = staff.body.staff[0];
    const second = await owner.post('/api/admin/team/staff', {
      name: 'Irina',
      title: { ro: 'Maestră', ru: 'Мастер', en: 'Nail artist' },
      weekly: firstMaster.weekly,
    });
    expect(second.status).toBe(201);
    const walkIn = { name: 'Elena', surname: 'Walk-In', phone: '079 555 111' };
    const start = '2026-06-02T08:00:00.000Z';
    const a = await owner.post('/api/admin/appointments', { newClient: walkIn, serviceIds: [gelId], start });
    const b = await owner.post('/api/admin/appointments', { newClient: { ...walkIn, phone: '079 555 222' }, serviceIds: [gelId], start });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.appointment.staff.id).not.toBe(b.body.appointment.staff.id);
  });
});
