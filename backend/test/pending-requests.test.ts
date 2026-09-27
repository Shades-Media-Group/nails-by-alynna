import { ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestContext,
  loginAs,
  registerClient,
  strongPassword,
  type TestClient,
  type TestContext,
} from './helpers';

/*
 * GET /api/admin/appointments/pending: the requests the studio still has to answer, for the
 * staff app's "New requests" sheet, the card on "Today" and the badges. The owner sees every
 * one; a master only those booked with them.
 */

let ctx: TestContext;
let owner: TestClient;
let gelId: string;
let clientId: string;
let alinaId: string;
let irinaId: string;
const MONDAY_9 = new Date('2026-06-01T06:00:00Z'); // 09:00 in Chișinău

async function makeStaff(email: string, name: string) {
  const { user } = await registerClient(ctx, { email, name, surname: 'Staff' });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(user.id) }, { $set: { role: 'admin' } });
  return { id: user.id, client: await loginAs(ctx, email, strongPassword) };
}

/** A booking made at the desk `minutesLater` than Monday 09:00 (its "sent" time). */
async function book(
  minutesLater: number,
  staffId: string,
  start: string,
  status: 'pending' | 'confirmed' = 'pending',
) {
  ctx.setNow(new Date(MONDAY_9.getTime() + minutesLater * 60_000));
  const res = await owner.post('/api/admin/appointments', {
    clientId,
    serviceIds: [gelId],
    staffId,
    start,
    status,
    force: true,
    nailShape: 'almond',
  });
  expect(res.status).toBe(201);
  return res.body.appointment.id as string;
}

const ids = (res: { body: { appointments: Array<{ id: string }> } }) =>
  res.body.appointments.map((a) => a.id);

beforeAll(async () => {
  ctx = await createTestContext();
  // The seeded owner is also the studio's first master (Alina).
  await ctx.seed({
    admin: {
      email: 'owner@example.com',
      password: strongPassword,
      name: 'Alina',
      surname: 'Owner',
    },
  });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
  const alina = (await ctx.deps.col.staff.findOne({}))!;
  alinaId = alina._id.toHexString();
  clientId = (await registerClient(ctx, { name: 'Maria', surname: 'Popescu' })).user.id;
});
afterAll(async () => {
  await ctx.close();
});

describe('pending requests', () => {
  let irina: TestClient;
  let desk: TestClient;
  let forIrina: string;
  let tuesday: string;
  let today: string;

  beforeAll(async () => {
    // A second master signs in with her own account, linked to her profile.
    const master = await makeStaff('irina@example.com', 'Irina');
    const alina = (await ctx.deps.col.staff.findOne({ _id: new ObjectId(alinaId) }))!;
    const profile = new ObjectId();
    await ctx.deps.col.staff.insertOne({
      ...alina,
      _id: profile,
      name: 'Irina',
      userId: new ObjectId(master.id),
      order: 2,
    });
    irinaId = profile.toHexString();
    irina = master.client;
    // Reception: staff with no master profile of their own.
    desk = (await makeStaff('desk@example.com', 'Dana')).client;

    // Sent in this order, for visits in another order.
    forIrina = await book(0, irinaId, '2026-06-03T07:00:00.000Z'); // Wednesday 10:00
    tuesday = await book(5, alinaId, '2026-06-02T09:00:00.000Z'); // Tuesday 12:00
    await book(8, alinaId, '2026-06-04T09:00:00.000Z', 'confirmed');
    today = await book(10, alinaId, '2026-06-01T08:00:00.000Z'); // today 11:00
  });

  it('gives the owner every request, the one waiting longest first', async () => {
    const res = await owner.get('/api/admin/appointments/pending');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([forIrina, tuesday, today]);
    expect(res.body).toMatchObject({ total: 3, scope: 'all' });
    // Everything a row shows: who, what, when, with whom, the shape and when it was sent.
    expect(res.body.appointments[0]).toMatchObject({
      status: 'pending',
      client: { name: 'Maria', surname: 'Popescu' },
      services: [expect.objectContaining({ id: gelId })],
      staff: { id: irinaId, name: 'Irina' },
      start: '2026-06-03T07:00:00.000Z',
      nailShape: 'almond',
      createdAt: MONDAY_9.toISOString(),
      clientStats: { visits: 0, noShows: 0 },
    });
  });

  it('gives a master only the requests booked with them', async () => {
    const res = await irina.get('/api/admin/appointments/pending');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([forIrina]);
    expect(res.body).toMatchObject({ total: 1, scope: 'own' });
  });

  it('gives staff without a master profile (the desk) every request', async () => {
    const res = await desk.get('/api/admin/appointments/pending');
    expect(ids(res)).toEqual([forIrina, tuesday, today]);
    expect(res.body.scope).toBe('all');
  });

  it('drops a request once it is answered, and once its visit is over', async () => {
    expect(
      (await owner.patch(`/api/admin/appointments/${tuesday}`, { status: 'confirmed' })).status,
    ).toBe(200);
    expect(
      (
        await irina.patch(`/api/admin/appointments/${forIrina}`, {
          status: 'cancelled',
          cancelReason: 'Fully booked',
        })
      ).status,
    ).toBe(200);
    expect(ids(await owner.get('/api/admin/appointments/pending'))).toEqual([today]);
    expect((await irina.get('/api/admin/appointments/pending')).body).toMatchObject({
      appointments: [],
      total: 0,
    });

    // Today's 11:00 visit (90 minutes) is over at 12:30: nothing left to confirm.
    ctx.setNow(new Date('2026-06-01T09:31:00Z'));
    expect((await owner.post('/api/auth/refresh')).status).toBe(200);
    expect((await owner.get('/api/admin/appointments/pending')).body).toMatchObject({
      appointments: [],
      total: 0,
      scope: 'all',
    });
  });

  it("won't confirm from a stale list a request the client cancelled meanwhile", async () => {
    ctx.setNow(MONDAY_9);
    expect((await owner.post('/api/auth/refresh')).status).toBe(200);
    const { client } = await registerClient(ctx, { name: 'Ana', surname: 'Late' });
    const day = await client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-10`);
    const booked = await client.post('/api/appointments', { serviceIds: [gelId], start: day.body.slots[0].start });
    expect(booked.body.appointment.status).toBe('pending');
    const id = booked.body.appointment.id as string;
    expect((await client.post(`/api/appointments/${id}/cancel`, {})).status).toBe(200);

    // The owner's list still showed it as a request.
    const stale = await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed', from: 'pending' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    const doc = await ctx.deps.col.appointments.findOne({ _id: new ObjectId(id) });
    expect(doc?.status).toBe('cancelled');
  });

  it('is for staff only', async () => {
    const { client } = await registerClient(ctx);
    expect((await client.get('/api/admin/appointments/pending')).status).toBe(403);
    expect((await ctx.client().get('/api/admin/appointments/pending')).status).toBe(401);
  });
});
