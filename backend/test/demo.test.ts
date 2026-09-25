import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maskPersonalData } from '../src/middleware/demo-mask';
import { createSession } from '../src/modules/auth/session';
import { DEMO_ACCOUNTS } from '../src/seed/run';
import { createTestContext, loginAs, strongPassword, type TestContext } from './helpers';

const DEMO_PASSWORD = 'demo-password-for-tests';
let ctx: TestContext;
let gelId: string;

beforeAll(async () => {
  ctx = await createTestContext({ DEMO_LOGIN: 'on' });
  await ctx.seed({
    admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' },
    demoUsers: { password: DEMO_PASSWORD },
    demoData: true,
  });
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
});
afterAll(async () => {
  await ctx.close();
});

describe('demo accounts', () => {
  it('can look at everything a client sees', async () => {
    const demo = await loginAs(ctx, 'client.demo@example.com', DEMO_PASSWORD);
    const me = await demo.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ isDemo: true, role: 'client' });
    expect((await demo.get('/api/appointments?scope=upcoming')).status).toBe(200);
    expect((await demo.get(`/api/availability/days?serviceIds=${gelId}&days=7`)).status).toBe(200);
  });

  it('cannot change anything: booking, profile, password, account, other sessions', async () => {
    const demo = await loginAs(ctx, 'client.demo@example.com', DEMO_PASSWORD);
    const attempts = await Promise.all([
      demo.post('/api/appointments', { serviceIds: [gelId], start: '2026-06-02T07:00:00.000Z' }),
      demo.patch('/api/me', { name: 'Changed' }),
      demo.post('/api/me/password', { currentPassword: DEMO_PASSWORD, newPassword: 'Another-Pass-2026' }),
      demo.delete('/api/me', { password: DEMO_PASSWORD }),
      demo.post('/api/auth/logout-all'),
    ]);
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DEMO_READ_ONLY');
    }
    // Still signed in, password unchanged, and logging out of this device works.
    await loginAs(ctx, 'client.demo@example.com', DEMO_PASSWORD);
    expect((await demo.post('/api/auth/logout')).status).toBe(200);
  });

  it('only sees its own device in the sessions list', async () => {
    await loginAs(ctx, 'client.demo@example.com', DEMO_PASSWORD);
    const mine = await loginAs(ctx, 'client.demo@example.com', DEMO_PASSWORD);
    const sessions = await mine.get('/api/auth/sessions');
    expect(sessions.body.sessions).toHaveLength(1);
    expect(sessions.body.sessions[0].current).toBe(true);
  });

  it('demo staff see the dashboard with masked personal data and cannot change it', async () => {
    const demoOwner = await loginAs(ctx, 'owner.demo@example.com', DEMO_PASSWORD);
    const clients = await demoOwner.get('/api/admin/clients');
    expect(clients.status).toBe(200);
    const maria = clients.body.clients.find((c: { name: string }) => c.name.startsWith('M'));
    expect(maria.name).toBe('M•••');
    expect(maria.surname).toBe('P.');
    expect(maria.phone).not.toContain('111222');
    expect(maria.email).not.toContain('popescu');

    const stats = await demoOwner.get('/api/admin/stats');
    expect(stats.status).toBe(200);
    for (const appt of stats.body.today.appointments) {
      expect(appt.client.name).toMatch(/•••$/);
    }
    const settings = await demoOwner.patch('/api/admin/settings', { requireApproval: true });
    expect(settings.body.error.code).toBe('DEMO_READ_ONLY');

    // The real owner still sees real data.
    const owner = await loginAs(ctx, 'owner@example.com', strongPassword);
    const real = await owner.get('/api/admin/clients');
    expect(real.body.clients.some((c: { surname: string }) => c.surname === 'Popescu')).toBe(true);
  });

  it('one-tap demo sign-in follows DEMO_LOGIN and never touches real accounts', async () => {
    const res = await ctx.client().post('/api/auth/demo', { role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ isDemo: true, role: 'admin', email: DEMO_ACCOUNTS[1]!.email });

    const config = await ctx.client().get('/api/config');
    expect(config.body.auth.demo).toEqual(expect.arrayContaining(['client', 'admin', 'administrator']));

    const off = await createTestContext({ DEMO_LOGIN: 'off' });
    try {
      await off.seed({ demoUsers: { password: DEMO_PASSWORD } });
      expect((await off.client().post('/api/auth/demo', { role: 'client' })).status).toBe(404);
      expect((await off.client().get('/api/config')).body.auth.demo).toEqual([]);
    } finally {
      await off.close();
    }
  });
});

describe('demo switched off', () => {
  it('is off unless DEMO_LOGIN enables it: no button, no password login, no old sessions', async () => {
    const off = await createTestContext();
    try {
      await off.seed({ demoUsers: { password: DEMO_PASSWORD } });
      expect((await off.client().get('/api/config')).body.auth.demo).toEqual([]);
      expect((await off.client().post('/api/auth/demo', { role: 'client' })).status).toBe(404);

      // The shared password is known, so the email form must refuse it too.
      const login = await off.client().post('/api/auth/login', { email: 'client.demo@example.com', password: DEMO_PASSWORD });
      expect(login.status).toBe(401);
      expect(login.body.error.code).toBe('INVALID_CREDENTIALS');

      // A session opened while the demo was on stops working.
      const demoUser = await off.deps.col.users.findOne({ email: 'client.demo@example.com' });
      const tokens = await createSession(off.deps, demoUser!, { remember: false });
      const client = off.client();
      client.cookies.set('nba_at', tokens.accessToken);
      client.cookies.set('nba_rt', tokens.refreshToken);
      expect((await client.get('/api/auth/me')).status).toBe(401);
      expect((await client.post('/api/auth/refresh')).status).toBe(401);
    } finally {
      await off.close();
    }
  });

  it('can be enabled for some roles only', async () => {
    const some = await createTestContext({ DEMO_LOGIN: 'client' });
    try {
      await some.seed({ demoUsers: { password: DEMO_PASSWORD } });
      expect((await some.client().get('/api/config')).body.auth.demo).toEqual(['client']);
      expect((await some.client().post('/api/auth/demo', { role: 'client' })).status).toBe(200);
      expect((await some.client().post('/api/auth/demo', { role: 'administrator' })).status).toBe(404);
      await expect(loginAs(some, 'owner.demo@example.com', DEMO_PASSWORD)).rejects.toThrow(/401/);
    } finally {
      await some.close();
    }
  });

  it('rejects an unknown DEMO_LOGIN value', async () => {
    await expect(createTestContext({ DEMO_LOGIN: 'owner' })).rejects.toThrow(/DEMO_LOGIN/);
  });
});

describe('maskPersonalData', () => {
  it('masks people but keeps business data', () => {
    const out = maskPersonalData({
      client: { name: 'Olga', surname: 'Ceban', phone: '+37368555666', email: 'olga@mail.md' },
      services: [{ name: { ro: 'Pedichiură', ru: 'Педикюр', en: 'Pedicure' }, price: 300 }],
      staff: { name: 'Alina', title: { en: 'Nail artist' } },
      staffNotes: 'Allergic to latex',
      totalPrice: 300,
    }) as Record<string, any>;
    expect(out.client).toEqual({ name: 'O•••', surname: 'C.', phone: '+373 ••• ••6', email: 'o•••@m•••' });
    expect(out.services[0].name.en).toBe('Pedicure');
    expect(out.staff.name).toBe('Alina');
    expect(out.staffNotes).toBe('•••');
    expect(out.totalPrice).toBe(300);
  });
});
