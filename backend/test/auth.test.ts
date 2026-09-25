import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ORIGIN, createTestContext, loginAs, registerClient, strongPassword, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('registration', () => {
  it('creates a client, signs them in for a year and hides secrets', async () => {
    const { client, user } = await registerClient(ctx, { email: 'Maria.Popa@Example.com' });
    expect(user).toMatchObject({ email: 'maria.popa@example.com', role: 'client' });
    expect(user).not.toHaveProperty('passwordHash');
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.phone).toBe('+37369123456');
  });

  it('sets hardened cookies', async () => {
    const client = ctx.client();
    const res = await client.post('/api/auth/register', {
      name: 'Irina',
      surname: 'Ceban',
      email: 'irina@example.com',
      phone: '+37368000000',
      password: strongPassword,
      acceptTerms: true,
    });
    expect(res.status).toBe(201);
    const access = res.setCookies.find((c) => c.startsWith('nba_at='))!;
    const refresh = res.setCookies.find((c) => c.startsWith('nba_rt='))!;
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Strict/i);
    expect(access).toMatch(/Max-Age=900/);
    expect(refresh).toMatch(/Path=\/api\/auth/);
    expect(refresh).toMatch(/Max-Age=31536000/);
  });

  it('rejects duplicates, weak passwords and missing consent', async () => {
    await registerClient(ctx, { email: 'dup@example.com' });
    const dup = await ctx.client().post('/api/auth/register', {
      name: 'A', surname: 'B', email: 'DUP@example.com', phone: '069000000', password: strongPassword, acceptTerms: true,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');

    const weak = await ctx.client().post('/api/auth/register', {
      name: 'A', surname: 'B', email: 'weak@example.com', phone: '069000000', password: '12345678', acceptTerms: true,
    });
    expect(weak.status).toBe(422);
    expect(weak.body.error.fields.password).toBe('too_common');

    const noConsent = await ctx.client().post('/api/auth/register', {
      name: 'A', surname: 'B', email: 'consent@example.com', phone: '069000000', password: strongPassword,
    });
    expect(noConsent.status).toBe(422);
    expect(noConsent.body.error.fields.acceptTerms).toBeDefined();
  });

  it('never lets a client choose a role', async () => {
    const res = await ctx.client().post('/api/auth/register', {
      name: 'Sly', surname: 'Hacker', email: 'sly@example.com', phone: '069000001', password: strongPassword,
      acceptTerms: true, role: 'administrator',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('client');
  });
});

describe('login & sessions', () => {
  it('uses one generic error for unknown email and wrong password', async () => {
    await registerClient(ctx, { email: 'known@example.com' });
    const unknown = await ctx.client().post('/api/auth/login', { email: 'nobody@example.com', password: 'whatever-123' });
    const wrong = await ctx.client().post('/api/auth/login', { email: 'known@example.com', password: 'wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('issues a browser-session refresh cookie without "remember me"', async () => {
    await registerClient(ctx, { email: 'short@example.com' });
    const client = ctx.client();
    const res = await client.post('/api/auth/login', { email: 'short@example.com', password: strongPassword, remember: false });
    expect(res.status).toBe(200);
    const refresh = res.setCookies.find((c) => c.startsWith('nba_rt='))!;
    expect(refresh).not.toMatch(/Max-Age/i);
  });

  it('rotates refresh tokens and revokes the session when an old token is replayed', async () => {
    await registerClient(ctx, { email: 'rotate@example.com' });
    const client = await loginAs(ctx, 'rotate@example.com', strongPassword);
    const firstToken = client.cookies.get('nba_rt')!;

    const refreshed = await client.post('/api/auth/refresh');
    expect(refreshed.status).toBe(200);
    const secondToken = client.cookies.get('nba_rt')!;
    expect(secondToken).not.toBe(firstToken);

    // A concurrent request with the old token inside the grace window is a benign race.
    const racer = ctx.client();
    racer.cookies.set('nba_rt', firstToken);
    expect((await racer.post('/api/auth/refresh')).status).toBe(409);

    // Long after rotation the old token is treated as stolen: the whole session dies.
    ctx.advance(60_000);
    const thief = ctx.client();
    thief.cookies.set('nba_rt', firstToken);
    expect((await thief.post('/api/auth/refresh')).status).toBe(401);
    expect((await client.post('/api/auth/refresh')).status).toBe(401);
  });

  it('logout revokes the refresh token; logout-all kills live access tokens', async () => {
    await registerClient(ctx, { email: 'out@example.com' });
    const phone = await loginAs(ctx, 'out@example.com', strongPassword);
    const laptop = await loginAs(ctx, 'out@example.com', strongPassword);

    const refreshToken = phone.cookies.get('nba_rt')!;
    await phone.post('/api/auth/logout');
    const replay = ctx.client();
    replay.cookies.set('nba_rt', refreshToken);
    expect((await replay.post('/api/auth/refresh')).status).toBe(401);

    const laptopAccess = laptop.cookies.get('nba_at')!;
    expect((await laptop.post('/api/auth/logout-all')).status).toBe(200);
    const stale = ctx.client();
    stale.cookies.set('nba_at', laptopAccess);
    const me = await stale.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
  });

  it('expires access tokens after 15 minutes', async () => {
    await registerClient(ctx, { email: 'ttl@example.com' });
    const client = await loginAs(ctx, 'ttl@example.com', strongPassword);
    ctx.advance(16 * 60_000);
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('TOKEN_EXPIRED');
    expect((await client.post('/api/auth/refresh')).status).toBe(200);
    expect((await client.get('/api/auth/me')).status).toBe(200);
  });

  it('rejects tampered tokens', async () => {
    const client = ctx.client();
    client.cookies.set('nba_at', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.');
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('emails a single-use link that signs out every device', async () => {
    await registerClient(ctx, { email: 'forgot@example.com' });
    const device = await loginAs(ctx, 'forgot@example.com', strongPassword);

    const unknown = await ctx.client().post('/api/auth/forgot-password', { email: 'ghost@example.com' });
    expect(unknown.status).toBe(200);
    const res = await ctx.client().post('/api/auth/forgot-password', { email: 'forgot@example.com', locale: 'ru' });
    expect(res.status).toBe(200);
    await ctx.flush();
    const mail = ctx.sentMail.find((m) => m.to === 'forgot@example.com')!;
    expect(mail.subject).toContain('Сброс пароля');
    const token = decodeURIComponent(/token=([^\s"&]+)/.exec(mail.text)![1]!);
    expect(mail.text).toContain(`${APP_ORIGIN}/ru/reset-password?token=`);

    const newPassword = 'Fresh-Coat-2027!';
    expect((await ctx.client().post('/api/auth/reset-password', { token, password: newPassword })).status).toBe(200);
    expect((await ctx.client().post('/api/auth/reset-password', { token, password: newPassword })).status).toBe(400);
    expect((await device.get('/api/auth/me')).status).toBe(401);
    await loginAs(ctx, 'forgot@example.com', newPassword);
  });
});

describe('CSRF defences', () => {
  it('rejects cross-site, foreign-origin and non-JSON state changes', async () => {
    await registerClient(ctx, { email: 'csrf@example.com' });
    const client = await loginAs(ctx, 'csrf@example.com', strongPassword);

    const crossSite = await client.post('/api/auth/logout-all', undefined, { 'sec-fetch-site': 'cross-site' });
    expect(crossSite.status).toBe(403);
    const evil = await client.post('/api/auth/logout-all', undefined, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const form = await client.post('/api/auth/login', 'email=a&password=b', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(415);
  });
});

describe('rate limiting', () => {
  it('locks an account after repeated failures', async () => {
    const limited = await createTestContext({ RATE_LIMITS: 'on' });
    try {
      await registerClient(limited, { email: 'brute@example.com' });
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await limited.client({ ip: `198.51.100.${i}` }).post('/api/auth/login', {
          email: 'brute@example.com',
          password: `wrong-${i}-password`,
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('proxy guard (host.md behind the Cloudflare Worker)', () => {
  it('serves only requests that carry the shared proxy key', async () => {
    const secret = 'proxy-secret-'.padEnd(40, 'z');
    const guarded = await createTestContext({ PROXY_SECRET: secret });
    try {
      const direct = await guarded.client().get('/api/config');
      expect(direct.status).toBe(404);
      expect(direct.body).toBe('Not Found');
      const wrong = await guarded.client().request('GET', '/api/config', undefined, { 'x-nba-proxy-key': 'nope' });
      expect(wrong.status).toBe(404);
      const proxied = await guarded.client().request('GET', '/api/config', undefined, { 'x-nba-proxy-key': secret });
      expect(proxied.status).toBe(200);
    } finally {
      await guarded.close();
    }
  });
});
