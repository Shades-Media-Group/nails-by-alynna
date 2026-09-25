import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

let ctx: TestContext;
let owner: TestClient;
let gelId: string;

const week = (tuesday: Array<{ start: string; end: string }>) => [
  [{ start: '10:00', end: '19:00' }],
  tuesday,
  [{ start: '10:00', end: '19:00' }],
  [{ start: '10:00', end: '19:00' }],
  [{ start: '10:00', end: '19:00' }],
  [{ start: '10:00', end: '16:00' }],
  [],
];

beforeAll(async () => {
  ctx = await createTestContext();
  // The seeded owner is also the studio's first master (Alina).
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
});
afterAll(async () => {
  await ctx.close();
});

describe('my schedule', () => {
  it('lets a master set their own week and break between clients, and says which bookings fall outside', async () => {
    const me = await owner.get('/api/admin/team/me');
    expect(me.status).toBe(200);
    expect(me.body.staff).toMatchObject({ name: 'Alina', bufferMin: 0 });

    // A client books Tuesday 15:00 (Chișinău, UTC+3).
    const { client } = await registerClient(ctx);
    const booked = await client.post('/api/appointments', { serviceIds: [gelId], start: '2026-06-02T12:00:00.000Z' });
    expect(booked.status).toBe(201);

    // Lunch from 14:00 to 15:30 on Tuesdays, and 10 minutes kept free after every client.
    const saved = await owner.patch('/api/admin/team/me', {
      weekly: week([
        { start: '10:00', end: '14:00' },
        { start: '15:30', end: '19:00' },
      ]),
      bufferMin: 10,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.staff.bufferMin).toBe(10);
    expect(saved.body.staff.weekly[1]).toHaveLength(2);
    // The 15:00 visit stays booked, and the master is told it is outside the new hours.
    expect(saved.body.outsideHours).toEqual([
      expect.objectContaining({ id: booked.body.appointment.id, start: '2026-06-02T12:00:00.000Z', clientName: 'Ana Rusu' }),
    ]);

    // Clients can no longer start a 90-minute gel that runs into the break.
    const slots = await client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-02`);
    const times = (slots.body.slots as Array<{ time: string }>).map((s) => s.time);
    expect(times).not.toContain('13:00');
    expect(times).not.toContain('14:00');
    expect(times).not.toContain('14:30');
  });

  it('rejects a break that is not in 5-minute steps and overlapping hours', async () => {
    expect((await owner.patch('/api/admin/team/me', { bufferMin: 7 })).status).toBe(422);
    const overlapping = await owner.patch('/api/admin/team/me', {
      weekly: week([
        { start: '10:00', end: '14:00' },
        { start: '13:00', end: '19:00' },
      ]),
    });
    expect(overlapping.status).toBe(422);
  });

  it('is only for staff with a master profile, and only their own', async () => {
    const { client, user } = await registerClient(ctx);
    expect((await client.get('/api/admin/team/me')).status).toBe(403);

    // Staff without a master profile (reception) have no week of their own.
    expect((await owner.patch(`/api/admin/users/${user.id}`, { role: 'admin' })).status).toBe(200);
    const reception = await loginAs(ctx, user.email, strongPassword);
    expect((await reception.get('/api/admin/team/me')).status).toBe(404);
    expect((await reception.patch('/api/admin/team/me', { bufferMin: 5 })).status).toBe(404);
    // ...and still cannot change a master's profile.
    const alina = (await owner.get('/api/admin/team/me')).body.staff;
    expect((await reception.patch(`/api/admin/team/staff/${alina.id}`, { bufferMin: 5 })).status).toBe(403);
  });
});
