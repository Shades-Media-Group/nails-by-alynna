import { ObjectId } from 'bson';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invalidateSettingsCache, switchToApprovalOnce } from '../src/modules/settings';
import { createTestContext, registerClient, type TestClient, type TestContext } from './helpers';

let ctx: TestContext;
let gelId: string;
let master: { client: TestClient; email: string };
let ownerEmail: string;

const mailsTo = (email: string) => ctx.sentMail.filter((m) => m.to === email);
const subjectsTo = (email: string, since: number) => mailsTo(email).slice(since).map((m) => m.subject);

async function setApproval(requireApproval: boolean) {
  await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $set: { requireApproval } });
  invalidateSettingsCache(ctx.deps);
}

async function freeSlots(client: TestClient, date = '2026-06-02') {
  const res = await client.get(`/api/availability/slots?serviceIds=${gelId}&date=${date}`);
  expect(res.status).toBe(200);
  return res.body.slots as Array<{ start: string }>;
}

/** A client in English (so subjects are readable here) with a booking on Tuesday. */
async function clientWithBooking() {
  const registered = await registerClient(ctx, { name: 'Ana', surname: 'Rusu' });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(registered.user.id) }, { $set: { locale: 'en' } });
  await ctx.flush();
  const since = mailsTo(registered.user.email).length;
  const [slot] = await freeSlots(registered.client);
  const res = await registered.client.post('/api/appointments', { serviceIds: [gelId], start: slot!.start });
  expect(res.status).toBe(201);
  return { ...registered, since, appointment: res.body.appointment as { id: string; status: string } };
}

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed();
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;

  // The master signs in to the staff app with an account of their own, linked to their profile.
  const registered = await registerClient(ctx, { name: 'Alina', surname: 'Master' });
  const masterId = new ObjectId(registered.user.id);
  await ctx.deps.col.users.updateOne({ _id: masterId }, { $set: { role: 'admin', locale: 'en' } });
  await ctx.deps.col.staff.updateOne({}, { $set: { userId: masterId } });
  master = { client: registered.client, email: registered.user.email };

  // The owner (administrator) hears about every booking.
  const owner = await registerClient(ctx, { name: 'Olga', surname: 'Owner' });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(owner.user.id) }, { $set: { role: 'administrator', locale: 'en' } });
  ownerEmail = owner.user.email;
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  ctx.setNow(new Date('2026-06-01T06:00:00Z')); // Monday 09:00 in Chișinău
  await ctx.flush();
  await ctx.deps.col.appointments.deleteMany({});
  await setApproval(true);
});

describe('a client books', () => {
  it('asks the master: the client hears the request was sent, the master and the owner get it', async () => {
    const before = { master: mailsTo(master.email).length, owner: mailsTo(ownerEmail).length };
    const { user, since, appointment } = await clientWithBooking();
    expect(appointment.status).toBe('pending');
    await ctx.flush();

    expect(subjectsTo(user.email, since)).toEqual([expect.stringMatching(/^Request sent: tomorrow at \d\d:\d\d$/)]);
    expect(mailsTo(user.email).at(-1)!.text).toContain('Alina will confirm your booking shortly');
    for (const [email, since] of [[master.email, before.master], [ownerEmail, before.owner]] as const) {
      expect(subjectsTo(email, since)).toEqual([expect.stringMatching(/^New request: Ana Rusu, Tomorrow, \d\d:\d\d$/)]);
      const mail = mailsTo(email).at(-1)!;
      expect(mail.text).toMatch(/Phone: \+?373/);
      expect(mail.html).toContain(`/en/admin/appointments/${appointment.id}`);
    }
  });

  it('when the studio confirms instantly, everyone hears the visit is booked', async () => {
    await setApproval(false);
    const since = mailsTo(master.email).length;
    const { user, since: clientSince, appointment } = await clientWithBooking();
    expect(appointment.status).toBe('confirmed');
    await ctx.flush();
    expect(subjectsTo(user.email, clientSince)).toEqual([expect.stringMatching(/^You're booked: tomorrow at/)]);
    expect(subjectsTo(master.email, since)).toEqual([expect.stringMatching(/^New booking: Ana Rusu, /)]);
  });

  it("tells the master and the owner when a client cancels or moves, and never twice", async () => {
    const { client, appointment } = await clientWithBooking();
    await ctx.flush();
    const since = { master: mailsTo(master.email).length, owner: mailsTo(ownerEmail).length };

    const slots = await freeSlots(client);
    const moved = await client.post(`/api/appointments/${appointment.id}/reschedule`, { start: slots.at(-1)!.start });
    expect(moved.status).toBe(200);
    expect((await client.post(`/api/appointments/${appointment.id}/cancel`, {})).status).toBe(200);
    await ctx.flush();

    for (const [email, from] of [[master.email, since.master], [ownerEmail, since.owner]] as const) {
      expect(subjectsTo(email, from)).toEqual([
        expect.stringMatching(/^Moved by the client: Ana Rusu, /),
        expect.stringMatching(/^Cancelled by the client: Ana Rusu, /),
      ]);
    }
    const logged = await ctx.deps.col.notificationLog.countDocuments({ kind: 'staff_booking' });
    const { notifyStaffOfBooking } = await import('../src/modules/notifications');
    await notifyStaffOfBooking(ctx.deps, appointment.id, 'cancelled');
    expect(await ctx.deps.col.notificationLog.countDocuments({ kind: 'staff_booking' })).toBe(logged);
  });

  it("follows each person's settings: a master who turned the emails off only loses the emails", async () => {
    expect((await master.client.patch('/api/notifications/prefs', { staffBookings: { email: false } })).status).toBe(200);
    const since = { master: mailsTo(master.email).length, owner: mailsTo(ownerEmail).length };
    await clientWithBooking();
    await ctx.flush();
    expect(mailsTo(master.email).length).toBe(since.master);
    expect(mailsTo(ownerEmail).length).toBe(since.owner + 1);
    expect((await master.client.patch('/api/notifications/prefs', { staffBookings: { email: true } })).status).toBe(200);
  });
});

describe('bookings wait for confirmation by default', () => {
  const reset = async (requireApproval: boolean, customized: string[]) => {
    await ctx.deps.col.meta.deleteOne({ _id: 'requireApprovalDefault' });
    await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $set: { requireApproval, customized } });
  };
  const current = async () => (await ctx.deps.col.settings.findOne({ _id: 'studio' }))!.requireApproval;

  it('switches an existing studio over once, unless the owner chose in Settings', async () => {
    await reset(false, []);
    await switchToApprovalOnce(ctx.deps);
    expect(await current()).toBe(true);

    // Turned off again afterwards: it stays off.
    await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $set: { requireApproval: false } });
    await switchToApprovalOnce(ctx.deps);
    expect(await current()).toBe(false);

    // An owner who already chose "instant" keeps it.
    await reset(false, ['requireApproval', 'phone']);
    await switchToApprovalOnce(ctx.deps);
    expect(await current()).toBe(false);
  });
});
