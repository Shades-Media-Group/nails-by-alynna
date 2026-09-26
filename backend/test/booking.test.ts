import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, registerClient, type TestClient, type TestContext } from './helpers';

let ctx: TestContext;
let gelId: string;
let artId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed();
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
  artId = catalog.body.services.find((s: { slug: string }) => s.slug === 'design-complex').id;
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  ctx.setNow(new Date('2026-06-01T06:00:00Z')); // Mon 09:00 local
  await ctx.deps.col.appointments.deleteMany({});
  await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $set: { requireApproval: false, maxActiveBookings: 3 } });
  // Settings are cached per runtime; drop the cache between tests.
  const { invalidateSettingsCache } = await import('../src/modules/settings');
  invalidateSettingsCache(ctx.deps);
});

async function slots(client: TestClient, date: string, serviceIds = [gelId]) {
  const res = await client.get(`/api/availability/slots?serviceIds=${serviceIds.join(',')}&date=${date}`);
  expect(res.status).toBe(200);
  return res.body.slots as Array<{ start: string; time: string; staffIds: string[] }>;
}

describe('availability', () => {
  it('requires a signed-in user', async () => {
    expect((await ctx.client().get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-02`)).status).toBe(401);
  });

  it('respects working hours, minimum notice and days off', async () => {
    const { client } = await registerClient(ctx);
    const today = await slots(client, '2026-06-01'); // 09:00 now + 2h notice → from 11:00
    expect(today[0]!.time).toBe('11:00');
    expect(today.at(-1)!.time).toBe('17:30'); // 90 min must end by 19:00
    expect(await slots(client, '2026-06-07')).toEqual([]); // Sunday
    expect(await slots(client, '2026-05-31')).toEqual([]); // past

    const days = await client.get(`/api/availability/days?serviceIds=${gelId}&days=7`);
    // Smart slots (on by default) count only times that leave no dead gap in the day.
    expect(days.body.days.map((d: { slots: number }) => d.slots)).toEqual([21, 21, 21, 21, 21, 9, 0]);
  });

  it('adds up the duration of several services', async () => {
    const { client } = await registerClient(ctx);
    const combined = await client.get(`/api/availability/slots?serviceIds=${gelId},${artId}&date=2026-06-02`);
    expect(combined.body.durationMin).toBe(120);
    expect(combined.body.slots.at(-1).time).toBe('17:00'); // 2 h must end by 19:00
  });
});

describe('booking', () => {
  it('books a published slot, removes it from availability and shows it upcoming', async () => {
    const { client } = await registerClient(ctx);
    const [first] = await slots(client, '2026-06-02');
    const res = await client.post('/api/appointments', { serviceIds: [gelId], start: first!.start, notes: 'Nude, please' });
    expect(res.status).toBe(201);
    expect(res.body.appointment).toMatchObject({ status: 'confirmed', totalPrice: 300, durationMin: 90, canChange: true });
    expect(res.body.appointment.code).toMatch(/^[A-Z2-9]{6}$/);

    const after = await slots(client, '2026-06-02');
    expect(after.some((s) => s.start === first!.start)).toBe(false);
    const upcoming = await client.get('/api/appointments?scope=upcoming');
    expect(upcoming.body.appointments).toHaveLength(1);
  });

  it('rejects times that are not published slots', async () => {
    const { client } = await registerClient(ctx);
    const misaligned = await client.post('/api/appointments', { serviceIds: [gelId], start: '2026-06-02T07:07:00.000Z' });
    expect(misaligned.status).toBe(409);
    expect(misaligned.body.error.code).toBe('SLOT_UNAVAILABLE');
    const sunday = await client.post('/api/appointments', { serviceIds: [gelId], start: '2026-06-07T08:00:00.000Z' });
    expect(sunday.status).toBe(409);
  });

  it('lets exactly one of two simultaneous bookings win the same slot', async () => {
    const a = await registerClient(ctx);
    const b = await registerClient(ctx);
    const [slot] = await slots(a.client, '2026-06-03');
    const results = await Promise.all([
      a.client.post('/api/appointments', { serviceIds: [gelId], start: slot!.start }),
      b.client.post('/api/appointments', { serviceIds: [gelId], start: slot!.start }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await ctx.deps.col.appointments.countDocuments({ status: 'confirmed' })).toBe(1);
  });

  it('creates pending requests when the studio approves bookings', async () => {
    await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $set: { requireApproval: true } });
    const { invalidateSettingsCache } = await import('../src/modules/settings');
    invalidateSettingsCache(ctx.deps);
    const { client } = await registerClient(ctx);
    const [slot] = await slots(client, '2026-06-02');
    const res = await client.post('/api/appointments', { serviceIds: [gelId], start: slot!.start });
    expect(res.body.appointment.status).toBe('pending');
  });

  it('limits upcoming bookings per client', async () => {
    const { client } = await registerClient(ctx);
    const day = await slots(client, '2026-06-04');
    // 10:00, 11:30, 13:00: back to back, so each is still offered after the one before.
    for (const i of [0, 1, 7]) {
      expect((await client.post('/api/appointments', { serviceIds: [gelId], start: day[i]!.start })).status).toBe(201);
    }
    const fourth = await client.post('/api/appointments', { serviceIds: [gelId], start: day.at(-1)!.start });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('BOOKING_LIMIT');
  });

  it('refuses clients blocked from online booking', async () => {
    const { client, user } = await registerClient(ctx);
    const { ObjectId } = await import('bson');
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(user.id) }, { $set: { bookingBlocked: true } });
    const [slot] = await slots(client, '2026-06-02');
    const res = await client.post('/api/appointments', { serviceIds: [gelId], start: slot!.start });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BOOKING_BLOCKED');
  });

  it("hides other clients' appointments", async () => {
    const owner = await registerClient(ctx);
    const other = await registerClient(ctx);
    const [slot] = await slots(owner.client, '2026-06-02');
    const booked = await owner.client.post('/api/appointments', { serviceIds: [gelId], start: slot!.start });
    const id = booked.body.appointment.id;
    expect((await other.client.get(`/api/appointments/${id}`)).status).toBe(404);
    expect((await other.client.post(`/api/appointments/${id}/cancel`, {})).status).toBe(404);
  });
});

describe('cancel & reschedule', () => {
  it('allows changes until the deadline, then asks to contact the studio', async () => {
    const { client } = await registerClient(ctx);
    const [slot] = await slots(client, '2026-06-02'); // 10:00 local, deadline 12 h before
    const booked = await client.post('/api/appointments', { serviceIds: [gelId], start: slot!.start });
    const id = booked.body.appointment.id;

    const later = (await slots(client, '2026-06-02')).find((s) => s.time === '15:00')!;
    const moved = await client.post(`/api/appointments/${id}/reschedule`, { start: later.start });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment.start).toBe(later.start);
    // The original time is free again.
    expect((await slots(client, '2026-06-02')).some((s) => s.start === slot!.start)).toBe(true);

    ctx.setNow(new Date('2026-06-02T05:00:00Z')); // 08:00 local, 7 h before 15:00
    expect((await client.post('/api/auth/refresh')).status).toBe(200);
    const late = await client.post(`/api/appointments/${id}/cancel`, { reason: 'sick' });
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe('CANCEL_WINDOW_PASSED');

    ctx.setNow(new Date('2026-06-01T06:00:00Z'));
    expect((await client.post('/api/auth/refresh')).status).toBe(200);
    const cancelled = await client.post(`/api/appointments/${id}/cancel`, { reason: 'sick' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.appointment).toMatchObject({ status: 'cancelled', cancelledBy: 'client', canChange: false });
    const past = await client.get('/api/appointments?scope=past');
    expect(past.body.appointments[0].id).toBe(id);
  });
});
