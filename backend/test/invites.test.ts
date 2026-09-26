import { ObjectId } from 'bson';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signInWithGoogle } from '../src/modules/auth/google';
import { findInvite } from '../src/modules/auth/invites';
import { createTestContext, latestCode, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

let ctx: TestContext;
let owner: TestClient;
let gelId: string;
let nextDay = 0;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
});
afterAll(() => ctx.close());
afterEach(() => ctx.setNow(new Date('2026-06-01T06:00:00Z')));

/** Staff book a walk-in at the desk; each call takes 11:00 on the next day (from Wednesday). */
async function bookWalkIn(name = 'Ioana') {
  const start = `2026-06-${String(3 + nextDay++).padStart(2, '0')}T08:00:00.000Z`;
  const res = await owner.post('/api/admin/appointments', {
    newClient: { name, surname: 'Rusu', phone: '069 555 123' },
    serviceIds: [gelId],
    start,
  });
  expect(res.status).toBe(201);
  return { clientId: res.body.appointment.client.id as string, appointmentId: res.body.appointment.id as string };
}

async function invite(clientId: string) {
  const res = await owner.post(`/api/admin/clients/${clientId}/invite`);
  expect(res.status).toBe(201);
  const url = new URL(res.body.url);
  return { url, token: url.searchParams.get('invite')! };
}

describe('invite a walk-in client', () => {
  it('turns the walk-in record into their account, bookings included', async () => {
    const { clientId, appointmentId } = await bookWalkIn();
    const { url, token } = await invite(clientId);
    expect(url.pathname).toBe('/signup'); // Romanian, the default language, has no prefix

    const info = await ctx.client().get(`/api/auth/invite/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.invite).toMatchObject({ name: 'Ioana', surname: 'Rusu', email: null });
    expect(info.body.invite.nextVisit).toBeTruthy();

    const client = ctx.client();
    const signup = await client.post('/api/auth/register', {
      name: 'Ioana',
      surname: 'Rusu',
      email: 'ioana.rusu@example.com',
      phone: '069 555 123',
      password: strongPassword,
      acceptTerms: true,
      invite: token,
    });
    expect(signup.status).toBe(201);
    expect(signup.body.verification.email).toBe('ioana.rusu@example.com');
    // The email typed at sign-up is confirmed with a code, which also signs in.
    const verified = await client.post('/api/auth/verify-email', {
      email: 'ioana.rusu@example.com',
      code: await latestCode(ctx, 'ioana.rusu@example.com'),
    });
    expect(verified.status).toBe(200);
    expect(verified.body.user.id).toBe(clientId);
    const upcoming = await client.get('/api/appointments?scope=upcoming');
    expect(upcoming.body.appointments.map((a: { id: string }) => a.id)).toContain(appointmentId);

    // Single use, and a registered client gets no new invites.
    expect((await ctx.client().get(`/api/auth/invite/${token}`)).status).toBe(404);
    const again = await ctx.client().post('/api/auth/register', {
      name: 'X', surname: 'Y', email: 'other@example.com', phone: '069 555 124', password: strongPassword, acceptTerms: true, invite: token,
    });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVITE_INVALID');
    expect((await owner.post(`/api/admin/clients/${clientId}/invite`)).body.error.code).toBe('ALREADY_REGISTERED');
  });

  it('keeps only the newest link, and links expire after 14 days', async () => {
    const { clientId } = await bookWalkIn('Olga');
    const first = await invite(clientId);
    const second = await invite(clientId);
    expect(await findInvite(ctx.deps, first.token)).toBeNull();
    expect(await findInvite(ctx.deps, second.token)).not.toBeNull();
    ctx.advance(15 * 86_400_000);
    expect((await ctx.client().get(`/api/auth/invite/${second.token}`)).status).toBe(404);
  });

  it('refuses an email that belongs to someone else and keeps the link usable', async () => {
    const { user } = await registerClient(ctx, { email: 'taken@example.com' });
    expect(user.email).toBe('taken@example.com');
    const { clientId } = await bookWalkIn('Elena');
    const { token } = await invite(clientId);
    const res = await ctx.client().post('/api/auth/register', {
      name: 'Elena', surname: 'Rusu', email: 'taken@example.com', phone: '069 555 125', password: strongPassword, acceptTerms: true, invite: token,
    });
    expect(res.status).toBe(409);
    expect(await findInvite(ctx.deps, token)).not.toBeNull();
  });

  it('can be claimed with Google too', async () => {
    const { clientId } = await bookWalkIn('Ana');
    const { token } = await invite(clientId);
    const claim = await findInvite(ctx.deps, token);
    const result = await signInWithGoogle(ctx.deps, { sub: 'google-ana', email: 'ana.g@gmail.com', givenName: 'Anna' }, 'ro', { claim });
    expect(result.ok && String(result.user._id)).toBe(clientId);
    const stored = await ctx.deps.col.users.findOne({ _id: new ObjectId(clientId) });
    // The name typed at the desk stays; the Google account and verified email are added.
    expect(stored).toMatchObject({ name: 'Ana', email: 'ana.g@gmail.com', googleId: 'google-ana' });
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await findInvite(ctx.deps, token)).toBeNull();
  });
});
