import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { signInWithGoogle } from '../src/modules/auth/google';
import { APP_ORIGIN, createTestContext, loginAs, registerClient, strongPassword, type TestContext } from './helpers';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const REDIRECT_URI = `${APP_ORIGIN}/api/auth/google/callback`;

let ctx: TestContext;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Record<string, unknown>;

beforeAll(async () => {
  ctx = await createTestContext({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'test-secret' });
  keys = await generateKeyPair('RS256');
  jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
});
afterAll(() => ctx.close());
afterEach(() => vi.unstubAllGlobals());

const identity = (overrides: Partial<Parameters<typeof signInWithGoogle>[1]> = {}) => ({
  sub: `g-${Math.random().toString(36).slice(2, 10)}`,
  email: `g.${Math.random().toString(36).slice(2, 8)}@gmail.com`,
  givenName: 'Ioana',
  familyName: 'Lungu',
  ...overrides,
});

/** Stands in for Google's token and JWKS endpoints; returns what the token endpoint received. */
function fakeGoogle(claims: (nonce: string) => Record<string, unknown>, getNonce: () => string) {
  const tokenRequests: URLSearchParams[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      return Response.json({ keys: [jwk] });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      const idToken = await new SignJWT(claims(getNonce()))
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://accounts.google.com')
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
      return Response.json({ id_token: idToken, access_token: 'unused', token_type: 'Bearer' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return tokenRequests;
}

describe('Google sign-in: start', () => {
  it('redirects to Google with PKCE, state and nonce, and keeps them in a Lax cookie', async () => {
    const client = ctx.client();
    const res = await client.get('/api/auth/google/start?lang=en&remember=1&next=/services');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = location.searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('openid email profile');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(q.get('state')).toBeTruthy();
    expect(q.get('nonce')).toBeTruthy();
    const cookie = res.setCookies.find((line) => line.startsWith('nba_oa='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/i);
  });

  it('sends people back to the login screen when Google is not configured', async () => {
    const plain = await createTestContext();
    try {
      const res = await plain.client().get('/api/auth/google/start?lang=ru');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${APP_ORIGIN}/ru/login?error=google_disabled`);
    } finally {
      await plain.close();
    }
  });
});

describe('Google sign-in: callback', () => {
  async function begin(next = '/home') {
    const client = ctx.client({ origin: null });
    const start = await client.get(`/api/auth/google/start?lang=en&remember=1&next=${encodeURIComponent(next)}`);
    const q = new URL(start.headers.get('location')!).searchParams;
    return { client, state: q.get('state')!, nonce: q.get('nonce')! };
  }

  it('signs up a new client, sets a session and lands on the requested page', async () => {
    const { client, state, nonce } = await begin('/services');
    const email = `new.${Date.now()}@gmail.com`;
    const tokenRequests = fakeGoogle(
      (n) => ({ sub: `sub-${Date.now()}`, email, email_verified: true, given_name: 'Ioana', family_name: 'Lungu', nonce: n }),
      () => nonce,
    );
    const res = await client.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${APP_ORIGIN}/en/services`);
    expect(tokenRequests[0]?.get('code_verifier')).toMatch(/^[\w-]{64}$/);
    expect(tokenRequests[0]?.get('redirect_uri')).toBe(REDIRECT_URI);

    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email, name: 'Ioana', surname: 'Lungu', role: 'client', locale: 'en' });
    const stored = await ctx.deps.col.users.findOne({ email });
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(stored?.termsAcceptedAt).toBeInstanceOf(Date);
    expect(stored?.passwordHash).toBeNull();
  });

  it('rejects a replayed state, a wrong nonce and an unverified email', async () => {
    // State that does not match the cookie.
    const first = await begin();
    const wrongState = await first.client.get('/api/auth/google/callback?code=abc&state=forged');
    expect(wrongState.headers.get('location')).toBe(`${APP_ORIGIN}/en/login?error=google`);

    // ID token minted for another login attempt.
    const second = await begin();
    fakeGoogle((n) => ({ sub: 's1', email: 'x@gmail.com', email_verified: true, nonce: `${n}-other` }), () => second.nonce);
    const wrongNonce = await second.client.get(`/api/auth/google/callback?code=abc&state=${second.state}`);
    expect(wrongNonce.headers.get('location')).toBe(`${APP_ORIGIN}/en/login?error=google`);

    // Google has not verified the address.
    const third = await begin();
    fakeGoogle((n) => ({ sub: 's2', email: 'y@gmail.com', email_verified: false, nonce: n }), () => third.nonce);
    const unverified = await third.client.get(`/api/auth/google/callback?code=abc&state=${third.state}`);
    expect(unverified.headers.get('location')).toBe(`${APP_ORIGIN}/en/login?error=google`);
    expect(await ctx.deps.col.users.findOne({ email: 'y@gmail.com' })).toBeNull();

    // The state cookie is single-use: the same callback URL cannot be replayed. Without the
    // cookie the language is unknown too, so the default (Romanian, unprefixed) login opens.
    const replay = await third.client.get(`/api/auth/google/callback?code=abc&state=${third.state}`);
    expect(replay.headers.get('location')).toBe(`${APP_ORIGIN}/login?error=google`);
  });

  it('reports a cancelled consent screen', async () => {
    const { client } = await begin();
    const res = await client.get('/api/auth/google/callback?error=access_denied&state=x');
    expect(res.headers.get('location')).toBe(`${APP_ORIGIN}/en/login?error=google_cancelled`);
  });
});

describe('Google sign-in: account linking', () => {
  it('returns the same account on every sign-in', async () => {
    const who = identity();
    const first = await signInWithGoogle(ctx.deps, who, 'ro');
    const again = await signInWithGoogle(ctx.deps, who, 'ro');
    expect(first.ok && first.created).toBe(true);
    expect(again.ok && !again.created && String(again.user._id)).toBe(first.ok && String(first.user._id));
  });

  it('keeps an empty surname when Google has none, and names from the email when there is no name', async () => {
    const result = await signInWithGoogle(ctx.deps, identity({ givenName: undefined, familyName: undefined, email: 'maria.b@gmail.com' }), 'ro');
    expect(result.ok && result.user).toMatchObject({ name: 'maria.b', surname: '' });
  });

  it('drops an unproven password and its sessions when the real owner signs in with Google (pre-hijack guard)', async () => {
    // An account from before email codes: let in by the migration, but its inbox was never proven.
    const email = `early.${Date.now()}@example.com`;
    const signup = await ctx.client().post('/api/auth/register', {
      name: 'Early', surname: 'Bird', email, phone: '069 123 457', password: strongPassword, acceptTerms: true,
    });
    expect(signup.status).toBe(201);
    await ctx.deps.col.users.updateOne({ email }, { $set: { emailVerifiedAt: ctx.now(), emailGrandfathered: true } });
    const client = await loginAs(ctx, email, strongPassword);
    expect((await client.get('/api/auth/me')).status).toBe(200);

    const result = await signInWithGoogle(ctx.deps, identity({ email }), 'ro');
    expect(result.ok && !result.created).toBe(true);

    // The session opened with the password is gone, and the password no longer works.
    expect((await client.get('/api/auth/me')).status).toBe(401);
    await expect(loginAs(ctx, email, strongPassword)).rejects.toThrow(/401/);
    const stored = await ctx.deps.col.users.findOne({ email });
    expect(stored?.passwordHash).toBeNull();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(stored?.emailGrandfathered).toBeUndefined();
    const log = await ctx.deps.col.auditLogs.findOne({ action: 'user.link_google', targetId: String(stored?._id) });
    expect(log?.meta).toEqual({ passwordRemoved: true });
  });

  it('also drops the password of a sign-up that never confirmed its email', async () => {
    const email = `pending.${Date.now()}@example.com`;
    await ctx.client().post('/api/auth/register', {
      name: 'Pending', surname: 'Code', email, phone: '069 123 458', password: strongPassword, acceptTerms: true,
    });
    const result = await signInWithGoogle(ctx.deps, identity({ email }), 'ro');
    expect(result.ok).toBe(true);
    const stored = await ctx.deps.col.users.findOne({ email });
    expect(stored?.passwordHash).toBeNull();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('keeps the password when the email was already proven', async () => {
    const { user } = await registerClient(ctx);
    await ctx.deps.col.users.updateOne({ email: user.email }, { $set: { emailVerifiedAt: ctx.now() } });

    const result = await signInWithGoogle(ctx.deps, identity({ email: user.email }), 'ro');
    expect(result.ok).toBe(true);
    await expect(loginAs(ctx, user.email, strongPassword)).resolves.toBeDefined();
  });

  it('refuses a second Google account for the same email, demo accounts and disabled accounts', async () => {
    const owner = identity();
    await signInWithGoogle(ctx.deps, owner, 'ro');
    const other = await signInWithGoogle(ctx.deps, identity({ email: owner.email }), 'ro');
    expect(other).toEqual({ ok: false, reason: 'google_conflict' });

    await ctx.seed({ demoUsers: { password: 'demo-pass-2026' } });
    const demo = await signInWithGoogle(ctx.deps, identity({ email: 'client.demo@example.com' }), 'ro');
    expect(demo).toEqual({ ok: false, reason: 'google' });

    const { user } = await registerClient(ctx);
    await ctx.deps.col.users.updateOne({ email: user.email }, { $set: { isActive: false } });
    const disabled = await signInWithGoogle(ctx.deps, identity({ email: user.email }), 'ro');
    expect(disabled).toEqual({ ok: false, reason: 'account_disabled' });
  });
});

describe('Google configuration', () => {
  const base = {
    APP_ENV: 'production',
    APP_URL: 'https://app.nails.example',
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    JWT_SECRET: 'x'.repeat(48),
  };

  it('builds the redirect URI from the public app address', () => {
    const config = loadConfig({ ...base, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 's' });
    expect(config.google?.redirectUri).toBe('https://app.nails.example/api/auth/google/callback');
    expect(config.cookieSecure).toBe(true);
  });

  it('refuses setups that would break sign-in in production', () => {
    expect(() => loadConfig({ ...base, APP_URL: 'http://localhost:5180' })).toThrow(/https/);
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: CLIENT_ID })).toThrow(/both/);
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'oops', GOOGLE_CLIENT_SECRET: 's' })).toThrow(/googleusercontent/);
  });
});
