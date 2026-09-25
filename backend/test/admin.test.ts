import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

let ctx: TestContext;
let owner: TestClient;
let gelId: string;

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
afterEach(() => {
  ctx.setNow(new Date('2026-06-01T06:00:00Z'));
});

async function makeStaff(role: 'admin' | 'administrator', email: string) {
  const { user } = await registerClient(ctx, { email });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(user.id) }, { $set: { role } });
  return { id: user.id, client: await loginAs(ctx, email, strongPassword) };
}

describe('role guards', () => {
  it('keeps clients out of the admin API', async () => {
    const { client } = await registerClient(ctx);
    expect((await client.get('/api/admin/stats')).status).toBe(403);
    expect((await ctx.client().get('/api/admin/stats')).status).toBe(401);
  });

  it('lets admins run the day and the price list, but not own the studio', async () => {
    const admin = await makeStaff('admin', 'staff1@example.com');
    expect((await admin.client.get('/api/admin/stats')).status).toBe(200);
    expect((await admin.client.get('/api/admin/clients')).status).toBe(200);
    expect((await admin.client.get('/api/admin/users')).status).toBe(403);
    expect((await admin.client.get('/api/admin/audit')).status).toBe(403);
    expect((await admin.client.patch('/api/admin/settings', { requireApproval: true })).status).toBe(403);
    // The price list is everyday work: staff may manage it (an empty body fails validation).
    expect((await admin.client.post('/api/admin/catalog/services', {})).status).toBe(422);
  });

  it('applies role changes immediately', async () => {
    const admin = await makeStaff('admin', 'staff2@example.com');
    const demote = await owner.patch(`/api/admin/users/${admin.id}`, { role: 'client' });
    expect(demote.status).toBe(200);
    // The old access token carries the old token version → rejected at once.
    expect((await admin.client.get('/api/admin/stats')).status).toBe(401);
    // After refreshing, the new role applies.
    expect((await admin.client.post('/api/auth/refresh')).status).toBe(200);
    expect((await admin.client.get('/api/admin/stats')).status).toBe(403);
  });

  it('prevents lock-out of the last administrator and self changes', async () => {
    const me = await owner.get('/api/auth/me');
    const self = await owner.patch(`/api/admin/users/${me.body.user.id}`, { role: 'admin' });
    expect(self.body.error.code).toBe('SELF_ACTION');

    const second = await makeStaff('administrator', 'owner2@example.com');
    const firstOwnerId = me.body.user.id;
    // Second administrator demotes the first: allowed while another administrator remains.
    expect((await second.client.patch(`/api/admin/users/${firstOwnerId}`, { role: 'admin' })).status).toBe(200);
    // Now the second is the only administrator; nobody can remove them.
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(firstOwnerId) }, { $set: { role: 'administrator' } });
    owner = await loginAs(ctx, 'owner@example.com', strongPassword);
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(second.id) }, { $set: { role: 'administrator' } });
    const users = await ctx.deps.col.users.countDocuments({ role: 'administrator' });
    expect(users).toBe(2);
  });

  it('deactivating a user signs them out everywhere', async () => {
    const { client, user } = await registerClient(ctx, { email: 'leaving@example.com' });
    expect((await owner.patch(`/api/admin/users/${user.id}`, { isActive: false })).status).toBe(200);
    expect((await client.get('/api/auth/me')).status).toBe(401);
    expect((await client.post('/api/auth/refresh')).status).toBe(401);
    const login = await ctx.client().post('/api/auth/login', { email: 'leaving@example.com', password: strongPassword });
    expect(login.status).toBe(403);
  });
});

describe('staff bookings & statuses', () => {
  it('books a walk-in for a new client and moves it through its lifecycle', async () => {
    const created = await owner.post('/api/admin/appointments', {
      newClient: { name: 'Elena', surname: 'Walk-In', phone: '079 555 555' },
      serviceIds: [gelId],
      start: '2026-06-02T13:00:00.000Z',
    });
    expect(created.status).toBe(201);
    const appt = created.body.appointment;
    expect(appt.client).toMatchObject({ name: 'Elena', phone: '+37379555555' });

    const early = await owner.patch(`/api/admin/appointments/${appt.id}`, { status: 'completed' });
    expect(early.status).toBe(409);

    ctx.setNow(new Date('2026-06-02T15:00:00Z'));
    // A day later the 15-minute access token has expired; the app refreshes silently.
    expect((await owner.post('/api/auth/refresh')).status).toBe(200);
    const done = await owner.patch(`/api/admin/appointments/${appt.id}`, { status: 'completed', staffNotes: 'Loved it' });
    expect(done.status).toBe(200);
    expect(done.body.appointment).toMatchObject({ status: 'completed', staffNotes: 'Loved it' });

    const invalid = await owner.patch(`/api/admin/appointments/${appt.id}`, { status: 'pending' });
    expect(invalid.body.error.code).toBe('INVALID_STATUS');
  });

  it('refuses overlapping staff bookings unless forced', async () => {
    const start = '2026-06-03T09:00:00.000Z';
    const client = { newClient: { name: 'Olga', surname: 'First', phone: '079000111' } };
    expect((await owner.post('/api/admin/appointments', { ...client, serviceIds: [gelId], start })).status).toBe(201);
    const clash = await owner.post('/api/admin/appointments', {
      newClient: { name: 'Olga', surname: 'Second', phone: '079000222' },
      serviceIds: [gelId],
      start,
    });
    expect(clash.body.error.code).toBe('SLOT_TAKEN');
    const forced = await owner.post('/api/admin/appointments', {
      newClient: { name: 'Olga', surname: 'Third', phone: '079000333' },
      serviceIds: [gelId],
      start,
      force: true,
    });
    expect(forced.status).toBe(201);
  });

  it('restores a cancelled visit only if the master still has their break around it', async () => {
    const me = await owner.get('/api/admin/team/me');
    expect((await owner.patch('/api/admin/team/me', { bufferMin: 15 })).status).toBe(200);
    try {
      // Gel 12:00–13:30 (Chișinău), cancelled; then 13:40 is booked, inside the 15-minute break.
      const first = await owner.post('/api/admin/appointments', {
        newClient: { name: 'Irina', surname: 'Restored', phone: '079000444' },
        serviceIds: [gelId],
        start: '2026-06-04T09:00:00.000Z',
      });
      expect(first.status).toBe(201);
      const id = first.body.appointment.id;
      expect((await owner.patch(`/api/admin/appointments/${id}`, { status: 'cancelled' })).status).toBe(200);
      const next = await owner.post('/api/admin/appointments', {
        newClient: { name: 'Irina', surname: 'Next', phone: '079000555' },
        serviceIds: [gelId],
        start: '2026-06-04T10:40:00.000Z',
        force: true,
      });
      expect(next.status).toBe(201);

      const restore = await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed' });
      expect(restore.status).toBe(409);
      expect(restore.body.error.code).toBe('SLOT_TAKEN');
      expect((await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed', force: true })).status).toBe(200);
    } finally {
      await owner.patch('/api/admin/team/me', { bufferMin: me.body.staff.bufferMin });
    }
  });

  it('time off removes availability', async () => {
    const staff = await owner.get('/api/admin/team/staff');
    const masterId = staff.body.staff[0].id;
    const created = await owner.post('/api/admin/team/time-off', {
      staffId: masterId,
      from: '2026-06-05',
      to: '2026-06-05',
      reason: 'Training',
    });
    expect(created.status).toBe(201);
    const { client } = await registerClient(ctx);
    const res = await client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-05`);
    expect(res.body.slots).toEqual([]);
  });

  it('finds clients by phone typed the local way', async () => {
    await owner.post('/api/admin/clients', { name: 'Victoria', surname: 'Search', phone: '+373 69 888 777' });
    const found = await owner.get('/api/admin/clients?q=069%20888%20777');
    expect(found.body.clients.map((c: { name: string }) => c.name)).toContain('Victoria');
  });

  it('records administrative actions in the audit log', async () => {
    const audit = await owner.get('/api/admin/audit');
    const actions = audit.body.logs.map((l: { action: string }) => l.action);
    expect(actions).toContain('user.role_change');
    expect(actions).toContain('appointment.create_staff');
  });
});
