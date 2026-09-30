import { ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setPushTransport } from '../src/lib/push';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * A master's profile is linked to the account they sign in with: that is who gets new requests on
 * their phone and sees My schedule. Only a staff account, and one master's at most.
 */

let ctx: TestContext;
let owner: TestClient;
let alinaId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Olga', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  alinaId = (await ctx.deps.col.staff.findOne({ name: 'Alina' }))!._id.toHexString();
});
afterAll(async () => {
  await ctx.close();
});

async function staffAccount() {
  return (await staffMember()).user.id as string;
}

async function staffMember() {
  const registered = await registerClient(ctx);
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(registered.user.id) }, { $set: { role: 'admin' } });
  return registered;
}

describe("linking a master to the account they sign in with", () => {
  it('takes a staff account, shown on the profile', async () => {
    const userId = await staffAccount();
    const res = await owner.patch(`/api/admin/team/staff/${alinaId}`, { userId });
    expect(res.status).toBe(200);
    expect(res.body.staff.userId).toBe(userId);
  });

  it('refuses a client account, and an account already linked to another master', async () => {
    const { user } = await registerClient(ctx);
    const client = await owner.patch(`/api/admin/team/staff/${alinaId}`, { userId: user.id });
    expect(client.status).toBe(422);
    expect(client.body.error.fields.userId).toBe('not_staff');

    const userId = await staffAccount();
    expect((await owner.patch(`/api/admin/team/staff/${alinaId}`, { userId })).status).toBe(200);
    const alina = (await ctx.deps.col.staff.findOne({ _id: new ObjectId(alinaId) }))!;
    const mariaId = new ObjectId();
    await ctx.deps.col.staff.insertOne({ ...alina, _id: mariaId, name: 'Maria', userId: null, order: alina.order + 1 });
    const second = await owner.patch(`/api/admin/team/staff/${mariaId.toHexString()}`, { userId });
    expect(second.status).toBe(422);
    expect(second.body.error.fields.userId).toBe('taken');
  });

  it('can be undone', async () => {
    const res = await owner.patch(`/api/admin/team/staff/${alinaId}`, { userId: null });
    expect(res.status).toBe(200);
    expect(res.body.staff.userId).toBeNull();
  });
});

describe('who hears about new requests (Team page)', () => {
  const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
  const reachOf = async () => ((await owner.get('/api/admin/team/staff/reach')).body.reach as Array<{ staffId: string }>).find((r) => r.staffId === alinaId);

  it('says when a master has no account, then how many of their phones get them', async () => {
    await owner.patch(`/api/admin/team/staff/${alinaId}`, { userId: null });
    expect(await reachOf()).toEqual({ staffId: alinaId, account: null, phones: 0, bookingAlerts: false });

    const master = await staffMember();
    await owner.patch(`/api/admin/team/staff/${alinaId}`, { userId: master.user.id });
    expect(await reachOf()).toMatchObject({ account: { id: master.user.id }, phones: 0, bookingAlerts: true });

    // Push set up on the server (a fake push service here).
    setPushTransport(ctx.deps, { send: async () => 201 });
    try {
      const subscribed = await master.client.post('/api/notifications/push/subscribe', { endpoint: 'https://web.push.apple.com/alina-phone', keys });
      expect(subscribed.status).toBe(200);
      expect(await reachOf()).toMatchObject({ phones: 1, bookingAlerts: true });
    } finally {
      setPushTransport(ctx.deps, null);
    }
  });

  it('is for the owner only', async () => {
    const master = await staffMember();
    expect((await master.client.get('/api/admin/team/staff/reach')).status).toBe(403);
  });
});
