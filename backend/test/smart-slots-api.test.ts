import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { minutesToTime, timeToMinutes } from '../src/lib/time';
import { invalidateSettingsCache } from '../src/modules/settings';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * Smart slots through the API: clients booking online get only start times that leave no dead gap
 * in a master's day; staff still see and book every free time.
 */

let ctx: TestContext;
let owner: TestClient;
let gelId: string; // 90 min
let refillId: string; // correction size 1, 105 min
let extensionId: string; // extensions size 1, 120 min

type Slot = { start: string; time: string; staffIds: string[] };
const TUESDAY = '2026-06-02';
const walkIn = (phone: string) => ({ name: 'Elena', surname: 'Walk-In', phone });

function every(from: string, to: string, step = 15): string[] {
  const out: string[] = [];
  for (let m = timeToMinutes(from); m <= timeToMinutes(to); m += step) out.push(minutesToTime(m));
  return out;
}

async function slots(who: TestClient, serviceId = gelId, extra = ''): Promise<Slot[]> {
  const res = await who.get(`/api/availability/slots?serviceIds=${serviceId}&date=${TUESDAY}${extra}`);
  expect(res.status).toBe(200);
  return res.body.slots as Slot[];
}
const times = async (who: TestClient, serviceId = gelId, extra = '') => (await slots(who, serviceId, extra)).map((s) => s.time);
const startOf = async (who: TestClient, time: string, serviceId = gelId) => (await slots(who, serviceId)).find((s) => s.time === time)?.start;
async function patchSettings(body: Record<string, unknown>) {
  const res = await owner.patch('/api/admin/settings', body);
  expect(res.status).toBe(200);
  return res.body.settings;
}

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  const id = async (key: string) => (await ctx.deps.col.services.findOne({ defaultKey: key }))!._id.toHexString();
  [gelId, refillId, extensionId] = await Promise.all([id('gel-polish'), id('correction-size-1'), id('extension-size-1')]);
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  ctx.setNow(new Date('2026-06-01T06:00:00Z')); // Mon 09:00 in Chișinău
  await owner.post('/api/auth/refresh');
  await ctx.deps.col.appointments.deleteMany({});
  await ctx.deps.col.staff.updateMany({}, { $unset: { bufferMin: '' } });
  // A studio that saved its settings before smart slots existed: the defaults apply.
  await ctx.deps.col.settings.updateOne(
    { _id: 'studio' },
    {
      $set: { leadTimeMin: 120, slotStepMin: 15, bufferMin: 0, maxActiveBookings: 10, requireApproval: false },
      $unset: { smartSlots: '', maxGapMin: '', minBookableGapMin: '' },
    },
  );
  invalidateSettingsCache(ctx.deps);
});

describe('smart slots settings', () => {
  it('are on by default, also for a studio that saved its settings before they existed', async () => {
    const res = await owner.get('/api/admin/settings');
    expect(res.body.settings).toMatchObject({ smartSlots: true, maxGapMin: 10, minBookableGapMin: 90 });
  });

  it('are validated, and only the owner changes them', async () => {
    for (const body of [
      { maxGapMin: -1 },
      { maxGapMin: 61 },
      { maxGapMin: 7.5 },
      { minBookableGapMin: 481 },
      { minBookableGapMin: '90' },
      { smartSlots: 'yes' },
    ]) {
      const res = await owner.patch('/api/admin/settings', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    const { client } = await registerClient(ctx);
    expect((await client.patch('/api/admin/settings', { smartSlots: false })).status).toBe(403);

    expect(await patchSettings({ maxGapMin: 5, minBookableGapMin: 120 })).toMatchObject({ maxGapMin: 5, minBookableGapMin: 120 });
    const doc = await ctx.deps.col.settings.findOne({ _id: 'studio' });
    expect(doc?.customized).toEqual(expect.arrayContaining(['maxGapMin', 'minBookableGapMin']));
  });
});

describe('what clients are offered', () => {
  it('only times that leave no dead gap, and the day strip counts only those', async () => {
    const { client } = await registerClient(ctx);
    expect(await times(client)).toEqual(['10:00', ...every('11:30', '16:00'), '17:30']);
    const days = await client.get(`/api/availability/days?serviceIds=${gelId}&days=7`);
    // Today (Mon, 09:00 + 2 h notice) starts at 11:00; Saturday closes at 16:00; Sunday off.
    expect(days.body.days.map((d: { slots: number }) => d.slots)).toEqual([21, 21, 21, 21, 21, 9, 0]);
  });

  it('continues back to back and refuses a time that would strand a gap', async () => {
    const first = await registerClient(ctx);
    const booked = await first.client.post('/api/appointments', { serviceIds: [gelId], start: await startOf(first.client, '10:00') });
    expect(booked.status).toBe(201);

    const { client } = await registerClient(ctx);
    const list = await times(client);
    expect(list[0]).toBe('11:30');
    for (const time of ['11:45', '12:00', '12:15', '12:30', '12:45']) expect(list).not.toContain(time);
    // 12:15 fits, but would leave 45 minutes nobody can book: refused.
    const stranded = await client.post('/api/appointments', { serviceIds: [gelId], start: '2026-06-02T09:15:00.000Z' });
    expect(stranded.status).toBe(409);
    expect(stranded.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await client.post('/api/appointments', { serviceIds: [gelId], start: await startOf(client, '11:30') })).status).toBe(201);
  });

  it('starts right where an uneven visit ends, even off the slot grid', async () => {
    await patchSettings({ slotStepMin: 30 });
    const first = await registerClient(ctx);
    const refill = await first.client.post('/api/appointments', { serviceIds: [refillId], start: await startOf(first.client, '10:00', refillId) });
    expect(refill.status).toBe(201);
    expect(refill.body.appointment.end).toBe('2026-06-02T08:45:00.000Z'); // 11:45 local

    const { client } = await registerClient(ctx);
    expect((await times(client))[0]).toBe('11:45'); // not on the 30-minute grid
    const next = await client.post('/api/appointments', { serviceIds: [gelId], start: '2026-06-02T08:45:00.000Z' });
    expect(next.status).toBe(201);
  });

  it('comes back to every free time when the owner switches it off', async () => {
    await patchSettings({ smartSlots: false });
    const { client } = await registerClient(ctx);
    expect(await times(client)).toEqual(every('10:00', '17:30'));
    const days = await client.get(`/api/availability/days?serviceIds=${gelId}&days=7`);
    expect(days.body.days.map((d: { slots: number }) => d.slots)).toEqual([27, 31, 31, 31, 31, 19, 0]);
  });
});

describe('staff', () => {
  it('still see and book every free time, and can always override', async () => {
    const { client } = await registerClient(ctx);
    await client.post('/api/appointments', { serviceIds: [gelId], start: await startOf(client, '10:00') });

    const staffTimes = await times(owner);
    expect(staffTimes).toEqual(every('11:30', '17:30'));
    const desk = await owner.post('/api/admin/appointments', {
      newClient: walkIn('079 555 101'),
      serviceIds: [gelId],
      start: '2026-06-02T09:15:00.000Z', // 12:15, not offered to clients
    });
    expect(desk.status).toBe(201);
  });
});

describe('moving a booking', () => {
  it('counts its own time as free and offers the smart times of the day without it', async () => {
    const { client } = await registerClient(ctx);
    const booked = await client.post('/api/appointments', { serviceIds: [gelId], start: await startOf(client, '10:00') });
    const id = booked.body.appointment.id as string;

    expect(await times(client, gelId, `&exclude=${id}`)).toEqual(['10:00', ...every('11:30', '16:00'), '17:30']);
    const moved = await client.post(`/api/appointments/${id}/reschedule`, { start: '2026-06-02T10:00:00.000Z' }); // 13:00
    expect(moved.status).toBe(200);
    // The morning is free again and bookable as one piece: 10:00 or 11:30 (back to back with 13:00).
    expect((await times(client)).slice(0, 2)).toEqual(['10:00', '11:30']);
  });
});

describe('several masters', () => {
  it('gives "any master" to the master the visit fits best', async () => {
    const staff = await owner.get('/api/admin/team/staff');
    const alina = staff.body.staff[0];
    const created = await owner.post('/api/admin/team/staff', {
      name: 'Irina',
      title: { ro: 'Maestră', ru: 'Мастер', en: 'Nail artist' },
      weekly: alina.weekly,
    });
    expect(created.status).toBe(201);
    const irinaId = created.body.staff.id as string;
    try {
      // Irina already has 10:00–11:30; Alina's day is empty.
      const desk = await owner.post('/api/admin/appointments', {
        newClient: walkIn('079 555 102'),
        serviceIds: [gelId],
        staffId: irinaId,
        start: '2026-06-02T07:00:00.000Z',
      });
      expect(desk.status).toBe(201);

      const { client } = await registerClient(ctx);
      const slot = (await slots(client)).find((s) => s.time === '11:30')!;
      expect(slot.staffIds).toEqual([irinaId, alina.id]);
      const res = await client.post('/api/appointments', { serviceIds: [gelId], start: slot.start });
      expect(res.status).toBe(201);
      expect(res.body.appointment.staff.id).toBe(irinaId); // back to back, Alina's day stays whole
    } finally {
      await ctx.deps.col.staff.deleteOne({ _id: new ObjectId(irinaId) });
    }
  });
});

describe("the gap a master's services can use", () => {
  it('never keeps open a gap shorter than the shortest service the master does', async () => {
    const { client } = await registerClient(ctx);
    await client.post('/api/appointments', { serviceIds: [extensionId], start: await startOf(client, '10:00', extensionId) });
    // Alina does everything (gel polish takes 90 min): 13:30 leaves 90 minutes after 12:00, bookable.
    expect(await times(client, extensionId)).toContain('13:30');

    const master = await ctx.deps.col.staff.findOne({});
    const extensions = await ctx.deps.col.services.find({ defaultKey: { $regex: /^extension-size-/ } }).toArray();
    await ctx.deps.col.staff.updateOne({ _id: master!._id }, { $set: { serviceIds: extensions.map((s) => s._id) } });
    try {
      // Only extensions now (2 h and more): 90 free minutes can't take anyone.
      const list = await times(client, extensionId);
      expect(list).not.toContain('13:30');
      expect(list).toContain('14:00');
    } finally {
      await ctx.deps.col.staff.updateOne({ _id: master!._id }, { $set: { serviceIds: null } });
    }
  });
});

describe("a master's own break after each client", () => {
  async function giveAlinaABreak(bufferMin: number) {
    const staff = await owner.get('/api/admin/team/staff');
    const alina = staff.body.staff[0];
    const res = await owner.patch(`/api/admin/team/staff/${alina.id}`, { bufferMin });
    expect(res.status).toBe(200);
    expect(res.body.staff.bufferMin).toBe(bufferMin);
    return alina.id as string;
  }

  it('is validated, and returned with the weekly hours', async () => {
    const staff = await owner.get('/api/admin/team/staff');
    const alina = staff.body.staff[0];
    expect(alina.bufferMin).toBe(0); // missing = 0
    for (const bufferMin of [-5, 7, 35, '15']) {
      expect((await owner.patch(`/api/admin/team/staff/${alina.id}`, { bufferMin })).status, String(bufferMin)).toBe(422);
    }
    await giveAlinaABreak(15);
    const listed = await ctx.client().get('/api/staff');
    expect(listed.body.staff[0]).toMatchObject({ weekly: alina.weekly, bufferMin: 15 });
  });

  it('is kept free after each visit for clients and staff alike', async () => {
    await giveAlinaABreak(15);
    const { client } = await registerClient(ctx);
    expect((await client.post('/api/appointments', { serviceIds: [gelId], start: await startOf(client, '10:00') })).status).toBe(201);

    const other = await registerClient(ctx);
    // Back to back after the visit and the break: 11:45, not 11:30.
    expect((await times(other.client))[0]).toBe('11:45');
    expect((await times(owner))[0]).toBe('11:45');
    const inBreak = await other.client.post('/api/appointments', { serviceIds: [gelId], start: '2026-06-02T08:30:00.000Z' });
    expect(inBreak.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await other.client.post('/api/appointments', { serviceIds: [gelId], start: '2026-06-02T08:45:00.000Z' })).status).toBe(201);
  });

  it('is checked again when staff book or move a visit, unless they override', async () => {
    await giveAlinaABreak(15);
    const first = await owner.post('/api/admin/appointments', { newClient: walkIn('079 555 201'), serviceIds: [gelId], start: '2026-06-02T07:00:00.000Z' });
    expect(first.status).toBe(201);
    // 11:30 is free, but it is Alina's break after the 10:00 visit.
    const squeezed = await owner.post('/api/admin/appointments', { newClient: walkIn('079 555 202'), serviceIds: [gelId], start: '2026-06-02T08:30:00.000Z' });
    expect(squeezed.body.error.code).toBe('SLOT_TAKEN');
    const later = await owner.post('/api/admin/appointments', { newClient: walkIn('079 555 203'), serviceIds: [gelId], start: '2026-06-02T11:00:00.000Z' });
    expect(later.status).toBe(201);
    const moved = await owner.post(`/api/admin/appointments/${later.body.appointment.id}/reschedule`, { start: '2026-06-02T08:30:00.000Z' });
    expect(moved.body.error.code).toBe('SLOT_TAKEN');
    const forced = await owner.post(`/api/admin/appointments/${later.body.appointment.id}/reschedule`, { start: '2026-06-02T08:30:00.000Z', force: true });
    expect(forced.status).toBe(200);
  });

  it('lets only one of two simultaneous bookings squeeze into the break', async () => {
    await giveAlinaABreak(15);
    await patchSettings({ smartSlots: false }); // every free time: 10:00 and 11:30 are both offered
    const a = await registerClient(ctx);
    const b = await registerClient(ctx);
    const [at10, at1130] = [await startOf(a.client, '10:00'), await startOf(b.client, '11:30')];
    const results = await Promise.all([
      a.client.post('/api/appointments', { serviceIds: [gelId], start: at10 }),
      b.client.post('/api/appointments', { serviceIds: [gelId], start: at1130 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await ctx.deps.col.appointments.countDocuments({ status: 'confirmed' })).toBe(1);
  });
});
