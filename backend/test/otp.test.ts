import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateNotifications } from '../src/db';
import type { UserDoc } from '../src/db/types';
import { sha256Hex } from '../src/lib/crypto';
import { generateOtpCode, needsEmailVerification } from '../src/modules/auth/otp';
import { createTestContext, latestCode, loginAs, registerClient, strongPassword, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

let counter = 0;
const freshEmail = () => `otp.${Date.now()}.${counter++}@example.com`;

async function signUp(email: string, locale: 'ro' | 'ru' | 'en' = 'ro') {
  const client = ctx.client();
  const res = await client.post('/api/auth/register', {
    name: 'Olga',
    surname: 'Ceban',
    email,
    phone: '069 222 333',
    password: strongPassword,
    acceptTerms: true,
    locale,
  });
  expect(res.status).toBe(201);
  return client;
}

const otherCode = (code: string) => (code === '000000' ? '111111' : '000000');

describe('email codes', () => {
  it('are six random digits, stored only as a keyed hash', async () => {
    const codes = Array.from({ length: 300 }, generateOtpCode);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(290);

    const email = freshEmail();
    await signUp(email);
    const code = await latestCode(ctx, email);
    const stored = await ctx.deps.col.otpCodes.findOne({ email });
    expect(stored).toMatchObject({ purpose: 'verify_email', attempts: 0, usedAt: null });
    expect(stored!.codeHash).toMatch(/^[a-f\d]{64}$/);
    expect(stored!.codeHash).not.toBe(await sha256Hex(code));
    expect(Object.keys(stored!)).not.toContain('code');
    expect(stored!.codeHash).not.toContain(code);
    expect(stored!.expiresAt.getTime() - stored!.createdAt.getTime()).toBe(10 * 60_000);
  });

  it('sign-up: a branded email in the chosen language; no session until the right code, which works once', async () => {
    const email = freshEmail();
    const client = await signUp(email, 'ru');
    await ctx.flush();
    const mail = ctx.sentMail.findLast((m) => m.to === email)!;
    expect(mail.subject).toMatch(/^Подтверждение email: код \d{6}$/);
    expect(mail.html).toContain('#FDE7FC');
    expect(mail.html).toContain('lang="ru"');
    expect(mail.text).toContain(email);
    const code = await latestCode(ctx, email);

    const wrong = await client.post('/api/auth/verify-email', { email, code: otherCode(code) });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatchObject({ code: 'CODE_INVALID', fields: { code: 'invalid_code' } });
    expect((await client.get('/api/auth/me')).status).toBe(401);

    const ok = await client.post('/api/auth/verify-email', { email, code: ` ${code.slice(0, 3)} ${code.slice(3)} `, remember: false });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email, role: 'client' });
    expect(ok.setCookies.find((c) => c.startsWith('nba_rt='))).not.toMatch(/Max-Age/i);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    expect((await ctx.deps.col.users.findOne({ email }))?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await ctx.deps.col.auditLogs.findOne({ action: 'user.verify_email' })).not.toBeNull();

    const again = await ctx.client().post('/api/auth/verify-email', { email, code });
    expect(again.body.error.code).toBe('CODE_INVALID');
  });

  it('locks a code after five wrong tries; a new code works', async () => {
    const email = freshEmail();
    await signUp(email);
    const code = await latestCode(ctx, email);
    for (let i = 0; i < 5; i++) {
      expect((await ctx.client().post('/api/auth/verify-email', { email, code: otherCode(code) })).status).toBe(400);
    }
    expect((await ctx.client().post('/api/auth/verify-email', { email, code })).body.error.code).toBe('CODE_INVALID');
    expect(await ctx.deps.col.auditLogs.findOne({ action: 'auth.code_locked' })).not.toBeNull();

    ctx.advance(61_000);
    expect((await ctx.client().post('/api/auth/verify-email/resend', { email })).status).toBe(200);
    const next = await latestCode(ctx, email);
    expect((await ctx.client().post('/api/auth/verify-email', { email, code: next })).status).toBe(200);
  });

  it('expire after ten minutes', async () => {
    const email = freshEmail();
    await signUp(email);
    const code = await latestCode(ctx, email);
    ctx.advance(10 * 60_000 + 1_000);
    expect((await ctx.client().post('/api/auth/verify-email', { email, code })).body.error.code).toBe('CODE_INVALID');
  });

  it('can be resent once a minute, and only the newest one works', async () => {
    const email = freshEmail();
    await signUp(email);
    const first = await latestCode(ctx, email);
    const sent = () => ctx.sentMail.filter((m) => m.to === email).length;
    const before = sent();

    const early = await ctx.client().post('/api/auth/verify-email/resend', { email });
    expect(early.body).toEqual({ ok: true, resendAfterSec: 60 });
    await ctx.flush();
    expect(sent()).toBe(before);

    ctx.advance(60_000);
    await ctx.client().post('/api/auth/verify-email/resend', { email, locale: 'en' });
    const second = await latestCode(ctx, email);
    expect(sent()).toBe(before + 1);
    expect(ctx.sentMail.findLast((m) => m.to === email)!.subject).toMatch(/^Confirm your email: code \d{6}$/);
    if (first !== second) {
      expect((await ctx.client().post('/api/auth/verify-email', { email, code: first })).status).toBe(400);
    }
    expect((await ctx.client().post('/api/auth/verify-email', { email, code: second })).status).toBe(200);
  });

  it('never reveal whether an account exists', async () => {
    const { user } = await registerClient(ctx);
    const pairs = [
      ['/api/auth/verify-email/resend', { email: 'nobody@example.com' }, { email: user.email }],
      ['/api/auth/verify-email', { email: 'nobody@example.com', code: '123456' }, { email: user.email, code: '123456' }],
      ['/api/auth/forgot-password', { email: 'nobody@example.com' }, { email: user.email }],
      [
        '/api/auth/reset-password/code',
        { email: 'nobody@example.com', code: '123456', password: 'Another-Coat-2027!' },
        { email: user.email, code: '123456', password: 'Another-Coat-2027!' },
      ],
    ] as const;
    for (const [path, unknownBody, knownBody] of pairs) {
      const unknown = await ctx.client().post(path, unknownBody);
      const known = await ctx.client().post(path, knownBody);
      expect(known.status, path).toBe(unknown.status);
      expect(known.body, path).toEqual(unknown.body);
    }
  });
});

describe('login with an unconfirmed email', () => {
  it('emails a fresh code instead of opening a session; the code signs in', async () => {
    const email = freshEmail();
    await signUp(email);
    ctx.advance(61_000);
    const before = ctx.sentMail.filter((m) => m.to === email).length;

    const login = await ctx.client().post('/api/auth/login', { email, password: strongPassword, remember: true });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(login.setCookies).toEqual([]);
    const code = await latestCode(ctx, email);
    expect(ctx.sentMail.filter((m) => m.to === email).length).toBe(before + 1);

    // A wrong password still says only "wrong email or password" (and sends nothing).
    const wrong = await ctx.client().post('/api/auth/login', { email, password: 'Wrong-Pass-2026' });
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const client = ctx.client();
    const res = await client.post('/api/auth/verify-email', { email, code, remember: true });
    expect(res.status).toBe(200);
    expect(res.setCookies.find((c) => c.startsWith('nba_rt='))).toMatch(/Max-Age=31536000/);
    await loginAs(ctx, email, strongPassword);
  });

  it('lets in accounts from before email codes (migration), staff and demo accounts', async () => {
    const now = ctx.now();
    const hash = await ctx.deps.passwords.hash(strongPassword);
    const base = (email: string, role: UserDoc['role'], extra: Partial<UserDoc> = {}): UserDoc => ({
      _id: new ObjectId(),
      email,
      name: 'Old',
      surname: 'Timer',
      phone: null,
      role,
      locale: 'ro',
      passwordHash: hash,
      googleId: null,
      emailVerifiedAt: null,
      isActive: true,
      bookingBlocked: false,
      tokenVersion: 0,
      notes: '',
      search: '',
      lastLoginAt: null,
      createdAt: new Date(now.getTime() - 86_400_000),
      updatedAt: now,
      deletedAt: null,
      ...extra,
    });
    const veteran = base('veteran@example.com', 'client');
    await ctx.deps.col.users.insertOne(veteran);
    expect((await ctx.client().post('/api/auth/login', { email: veteran.email, password: strongPassword })).status).toBe(403);

    // The one-off migration step (it already ran on this database, before these users existed).
    await ctx.deps.col.meta.deleteOne({ _id: 'emailVerificationGrandfathered' });
    await migrateNotifications(ctx.deps.db, now);
    const marked = await ctx.deps.col.users.findOne({ _id: veteran._id });
    expect(marked).toMatchObject({ emailVerifiedAt: now, emailGrandfathered: true });
    await loginAs(ctx, veteran.email, strongPassword);

    // Sign-ups after the migration still need their code, even when the step runs again.
    const email = freshEmail();
    await signUp(email);
    await migrateNotifications(ctx.deps.db, ctx.now());
    expect((await ctx.deps.col.users.findOne({ email }))?.emailVerifiedAt).toBeNull();

    // Staff and demo accounts are never asked for a code.
    await ctx.deps.col.users.insertOne(base('desk@example.com', 'admin'));
    await loginAs(ctx, 'desk@example.com', strongPassword);
    expect(needsEmailVerification({ role: 'client', isDemo: true, emailVerifiedAt: null, passwordHash: 'x' })).toBe(false);
    expect(needsEmailVerification({ role: 'client', emailVerifiedAt: null, passwordHash: null })).toBe(false);
    expect(needsEmailVerification({ role: 'client', emailVerifiedAt: null, passwordHash: 'x' })).toBe(true);
  });
});

describe('password reset with a code', () => {
  it('resets with email + code + new password, signs out everywhere, and the link dies too', async () => {
    const { user } = await registerClient(ctx);
    const device = await loginAs(ctx, user.email, strongPassword);

    expect((await ctx.client().post('/api/auth/forgot-password', { email: user.email, locale: 'en' })).status).toBe(200);
    await ctx.flush();
    const mail = ctx.sentMail.findLast((m) => m.to === user.email)!;
    expect(mail.subject).toMatch(/^Reset your password: code \d{6}$/);
    expect(mail.text).toContain('/en/reset-password?token=');
    const code = /(\d{6})$/.exec(mail.subject)![1]!;
    const token = decodeURIComponent(/token=([^\s"&]+)/.exec(mail.text)![1]!);

    // Same password policy as the link (validation runs before the code is even looked at).
    const weak = await ctx.client().post('/api/auth/reset-password/code', { email: user.email, code, password: '12345678' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.fields.password).toBe('too_common');

    const ok = await ctx.client().post('/api/auth/reset-password/code', { email: user.email, code, password: 'Fresh-Coat-2027!' });
    expect(ok.status).toBe(200);
    expect((await device.get('/api/auth/me')).status).toBe(401);
    expect((await ctx.client().post('/api/auth/reset-password/code', { email: user.email, code, password: 'Fresh-Coat-2028!' })).status).toBe(400);
    expect((await ctx.client().post('/api/auth/reset-password', { token, password: 'Fresh-Coat-2029!' })).status).toBe(400);
    await loginAs(ctx, user.email, 'Fresh-Coat-2027!');
    const log = await ctx.deps.col.auditLogs.findOne({ action: 'user.password_reset', targetId: user.id });
    expect(log?.meta).toEqual({ via: 'code' });
  });

  it('proves the inbox of a sign-up that never entered its code', async () => {
    const email = freshEmail();
    await signUp(email);
    await ctx.client().post('/api/auth/forgot-password', { email });
    const code = await latestCode(ctx, email);
    expect((await ctx.client().post('/api/auth/reset-password/code', { email, code, password: 'Brand-New-Coat-26' })).status).toBe(200);
    await loginAs(ctx, email, 'Brand-New-Coat-26');
  });
});

describe('change email', () => {
  it('sends the code to the new address and switches over once it is entered', async () => {
    const { client, user } = await registerClient(ctx);
    const { user: other } = await registerClient(ctx);
    const target = freshEmail();

    const wrongPassword = await client.post('/api/me/email', { email: target, password: 'Not-My-Pass-1' });
    expect(wrongPassword.status).toBe(422);
    expect(wrongPassword.body.error.fields).toEqual({ password: 'wrong' });
    expect((await client.post('/api/me/email', { email: user.email, password: strongPassword })).body.error.fields).toEqual({ email: 'same_email' });
    expect((await client.post('/api/me/email', { email: other.email, password: strongPassword })).status).toBe(409);

    const start = await client.post('/api/me/email', { email: target, password: strongPassword, locale: 'en' });
    expect(start.status).toBe(200);
    expect(start.body.verification.email).toBe(target);
    const code = await latestCode(ctx, target);
    expect(ctx.sentMail.findLast((m) => m.to === target)!.subject).toMatch(/^Confirm your new email: code \d{6}$/);

    // The code belongs to this account only.
    const { client: stranger } = await registerClient(ctx);
    expect((await stranger.post('/api/me/email/verify', { email: target, code })).status).toBe(400);

    const done = await client.post('/api/me/email/verify', { email: target, code });
    expect(done.status).toBe(200);
    expect(done.body.user.email).toBe(target);
    await ctx.flush();
    // In the account's language (Romanian here).
    expect(ctx.sentMail.findLast((m) => m.to === user.email)!.subject).toBe('Emailul contului Nails by Alynna a fost schimbat');
    await loginAs(ctx, target, strongPassword);
    await expect(loginAs(ctx, user.email, strongPassword)).rejects.toThrow(/401/);
  });

  it('sends a code straight away to a corrected address, and only the newest one works', async () => {
    const { client } = await registerClient(ctx);
    const typo = freshEmail();
    const fixed = freshEmail();
    await client.post('/api/me/email', { email: typo, password: strongPassword });
    const typoCode = await latestCode(ctx, typo);
    await client.post('/api/me/email', { email: fixed, password: strongPassword });
    const fixedCode = await latestCode(ctx, fixed);
    expect((await client.post('/api/me/email/verify', { email: typo, code: typoCode })).status).toBe(400);
    expect((await client.post('/api/me/email/verify', { email: fixed, code: fixedCode })).status).toBe(200);
  });

  it('resends only for an address started with the password', async () => {
    const { client } = await registerClient(ctx);
    const target = freshEmail();
    await client.post('/api/me/email/resend', { email: target });
    await ctx.flush();
    expect(ctx.sentMail.some((m) => m.to === target)).toBe(false);

    await client.post('/api/me/email', { email: target, password: strongPassword });
    ctx.advance(61_000);
    await client.post('/api/me/email/resend', { email: target });
    await ctx.flush();
    expect(ctx.sentMail.filter((m) => m.to === target)).toHaveLength(2);
    expect((await client.post('/api/me/email/verify', { email: target, code: await latestCode(ctx, target) })).status).toBe(200);
  });
});
