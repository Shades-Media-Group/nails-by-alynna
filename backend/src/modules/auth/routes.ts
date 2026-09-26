import { ObjectId } from 'bson';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Role } from '../../config';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES, type UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { randomToken, sha256Base64Url, sha256Hex, timingSafeEqualStr } from '../../lib/crypto';
import { passwordResetEmail } from '../../lib/emails';
import { AppError, isDuplicateKey } from '../../lib/errors';
import { openState, sealState } from '../../lib/jwt';
import { enforceRateLimits } from '../../lib/rate-limit';
import { userSearch } from '../../lib/text';
import {
  LOCALES,
  emailSchema,
  localeSchema,
  paramId,
  parseJson,
  parseQuery,
  passwordSchema,
  personNameSchema,
  phoneSchema,
  type Locale,
} from '../../lib/validation';
import { demoSwitchedOff, requireAuth } from '../../middleware/auth';
import {
  OAUTH_PATH,
  clearSessionCookies,
  cookieNames,
  readRefreshToken,
  setSessionCookies,
} from './cookies';
import { signInWithGoogle } from './google';
import { consumeInvite, findInvite } from './invites';
import { isPlaceholderEmail } from '../../lib/placeholder-email';
import {
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  issueOtp,
  needsEmailVerification,
  otpCodeSchema,
  revokeOtps,
  sendEmailCode,
  type CodeDelivery,
  emailNotSent,
  mailWorking,
  verifyOtp,
} from './otp';
import {
  createSession,
  revokeAllSessions,
  revokeSessionByToken,
  rotateSession,
  toPublicUser,
} from './session';
import { getSettings } from '../settings';
import { notifyWelcome } from '../notifications';

const RESET_TTL_MS = 30 * 60_000;

/** What the app needs to show the "enter the code" screen (or "the email did not go out"). */
const pendingVerification = (email: string, delivery: CodeDelivery) => ({
  verification: { email, sent: delivery !== 'failed', expiresInSec: OTP_TTL_MS / 1000, resendAfterSec: OTP_RESEND_COOLDOWN_MS / 1000 },
});

const codeInvalid = () => new AppError(400, 'CODE_INVALID', 'The code is wrong or has expired', { fields: { code: 'invalid_code' } });
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
let googleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export const localePrefix = (locale: Locale) => (locale === 'ro' ? '' : `/${locale}`);

/** Only same-app relative paths are accepted as post-login destinations. */
function safeNext(next: string | undefined): string {
  if (!next || !/^\/(?!\/)[\w\-/?=&,.%]*$/.test(next) || next.length > 200) return '/home';
  return next;
}

export function authRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const { config, col } = deps;
  const auth = requireAuth(deps);
  const meta = (c: { req: { header: (n: string) => string | undefined } }, ip: string) => ({
    userAgent: c.req.header('user-agent'),
    ip,
  });

  // ── Sign up ────────────────────────────────────────────────────────────────
  const registerSchema = z.object({
    name: personNameSchema,
    surname: personNameSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    locale: localeSchema.default('ro'),
    remember: z.boolean().default(true),
    acceptTerms: z.literal(true, { error: 'required' }),
    /** Token from a studio invite link: the account is created on the walk-in record. */
    invite: z.string().trim().max(120).optional(),
  });

  app.post('/register', async (c) => {
    const ip = c.get('ip');
    await enforceRateLimits(deps, [{ key: `register:ip:${ip}`, limit: 10, windowSec: 3600 }]);
    const input = await parseJson(c, registerSchema);

    const localPart = input.email.split('@')[0] ?? '';
    if (localPart.length >= 4 && input.password.toLowerCase().includes(localPart)) {
      throw new AppError(422, 'WEAK_PASSWORD', 'Password contains the email', {
        fields: { password: 'contains_email' },
      });
    }

    if (input.invite) return claimWithPassword(c, input);

    const exists = await col.users.findOne({ email: input.email }, { projection: { _id: 1 } });
    if (exists) {
      throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { email: 'taken' } });
    }

    const now = deps.now();
    const user: UserDoc = {
      _id: new ObjectId(),
      email: input.email,
      name: input.name,
      surname: input.surname,
      phone: input.phone,
      role: 'client',
      locale: input.locale,
      passwordHash: await deps.passwords.hash(input.password),
      googleId: null,
      // Proven with the emailed code (POST /verify-email), which also opens the first session.
      emailVerifiedAt: null,
      termsAcceptedAt: now,
      isActive: true,
      bookingBlocked: false,
      tokenVersion: 0,
      notes: '',
      search: userSearch(input.name, input.surname, input.email, input.phone),
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    try {
      await col.users.insertOne(user);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { email: 'taken' } });
      }
      throw error;
    }

    await audit(deps, { actorId: user._id, action: 'user.register', targetType: 'user', targetId: user._id });
    // The account exists either way; the app offers to send the code again if it did not go out.
    const delivery = await sendEmailCode(deps, { user, purpose: 'verify_email', email: user.email, locale: input.locale });
    return c.json(pendingVerification(user.email, delivery), 201);
  });

  /** Sign-up through an invite: the walk-in record becomes the account, bookings included. */
  async function claimWithPassword(c: Context<AppEnv>, input: z.infer<typeof registerSchema>) {
    const found = await findInvite(deps, input.invite ?? '');
    if (!found) throw new AppError(400, 'INVITE_INVALID', 'The invitation is invalid or has expired');
    const { invite, user: invited } = found;
    const taken = await col.users.findOne({ email: input.email, _id: { $ne: invited._id } }, { projection: { _id: 1 } });
    if (taken) throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { email: 'taken' } });
    if (!(await consumeInvite(deps, invite))) throw new AppError(400, 'INVITE_INVALID', 'The invitation is invalid or has expired');

    const now = deps.now();
    const set: Partial<UserDoc> = {
      email: input.email,
      name: input.name,
      surname: input.surname,
      phone: input.phone,
      locale: input.locale,
      passwordHash: await deps.passwords.hash(input.password),
      // The studio typed the details at the desk; the address still has to be proven.
      emailVerifiedAt: null,
      termsAcceptedAt: now,
      search: userSearch(input.name, input.surname, input.email, input.phone),
      updatedAt: now,
    };
    try {
      await col.users.updateOne({ _id: invited._id }, { $set: set, $unset: { emailGrandfathered: '' } });
    } catch (error) {
      if (isDuplicateKey(error)) throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { email: 'taken' } });
      throw error;
    }
    const user: UserDoc = { ...invited, ...set };
    await audit(deps, { actorId: user._id, action: 'user.claim_invite', targetType: 'user', targetId: user._id });
    const delivery = await sendEmailCode(deps, { user, purpose: 'verify_email', email: user.email, locale: input.locale });
    return c.json(pendingVerification(user.email, delivery), 201);
  }

  /** What the sign-up screen shows for an invite link: who it is for and the next visit. */
  app.get('/invite/:token', async (c) => {
    await enforceRateLimits(deps, [{ key: `invite:ip:${c.get('ip')}`, limit: 30, windowSec: 900 }]);
    const found = await findInvite(deps, c.req.param('token'));
    if (!found) throw new AppError(404, 'INVITE_INVALID', 'The invitation is invalid or has expired');
    const { user } = found;
    const next = await col.appointments.findOne(
      { clientId: user._id, status: { $in: ACTIVE_STATUSES }, start: { $gt: deps.now() } },
      { sort: { start: 1 }, projection: { start: 1 } },
    );
    return c.json({
      invite: {
        name: user.name,
        surname: user.surname,
        phone: user.phone,
        email: isPlaceholderEmail(user.email) ? null : user.email,
        locale: user.locale,
        nextVisit: next?.start.toISOString() ?? null,
      },
    });
  });

  // ── Log in ─────────────────────────────────────────────────────────────────
  const loginSchema = z.object({
    // "demo" is the shareable shortcut to the client demo account (see DEMO_LOGIN).
    email: z.string().trim().toLowerCase().max(254, 'too_long').pipe(z.union([z.literal('demo'), emailSchema])),
    password: z.string().min(1, 'required').max(128, 'too_long'),
    remember: z.boolean().default(true),
  });

  /** Signs in the shared, read-only demo account of a role, if that role's demo is enabled. */
  const demoSession = async (c: Context<AppEnv>, role: Role) => {
    const user = await col.users.findOne({ isDemo: true, role, isActive: true, deletedAt: null });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Demo account not available');
    const tokens = await createSession(deps, user, { remember: false, ...meta(c, c.get('ip')) });
    setSessionCookies(c, config, tokens);
    return c.json({ user: toPublicUser(user) });
  };

  app.post('/login', async (c) => {
    const ip = c.get('ip');
    const input = await parseJson(c, loginSchema);
    await enforceRateLimits(deps, [
      { key: `login:ip:${ip}`, limit: 30, windowSec: 900 },
      { key: `login:acct:${input.email}`, limit: 10, windowSec: 900 },
    ]);

    // demo / demo: the client demo account, when enabled. Anything else behaves like a wrong login.
    if (input.email === 'demo') {
      if (input.password === 'demo' && config.demoRoles.includes('client')) return demoSession(c, 'client');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const user = await col.users.findOne({ email: input.email });
    if (!user || !user.passwordHash || user.deletedAt || demoSwitchedOff(deps, user)) {
      await deps.passwords.burn();
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const { ok, needsRehash } = await deps.passwords.verify(input.password, user.passwordHash);
    if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'Account disabled');
    if (needsEmailVerification(user)) {
      // No session until the inbox is proven: a fresh code is on its way (at most one a minute),
      // and POST /verify-email signs in.
      const delivery = await sendEmailCode(deps, { user, purpose: 'verify_email', email: user.email, locale: user.locale });
      if (delivery === 'failed') throw emailNotSent();
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Confirm your email with the code we sent');
    }

    const now = deps.now();
    const set: Partial<UserDoc> = { lastLoginAt: now, updatedAt: now };
    if (needsRehash) set.passwordHash = await deps.passwords.hash(input.password);
    await col.users.updateOne({ _id: user._id }, { $set: set });

    const tokens = await createSession(deps, user, { remember: input.remember, ...meta(c, ip) });
    setSessionCookies(c, config, tokens);
    return c.json({ user: toPublicUser({ ...user, ...set }) });
  });

  // ── Email verification (after sign-up, or a login with an unproven address) ──────
  const verifyEmailSchema = z.object({ email: emailSchema, code: otpCodeSchema, remember: z.boolean().default(true) });

  /** The emailed code proves the address and signs in, like a login. */
  app.post('/verify-email', async (c) => {
    const ip = c.get('ip');
    const input = await parseJson(c, verifyEmailSchema);
    await enforceRateLimits(deps, [
      { key: `otp:verify:ip:${ip}`, limit: 30, windowSec: 900 },
      { key: `otp:verify:acct:${input.email}`, limit: 15, windowSec: 900 },
    ]);

    const result = await verifyOtp(deps, { purpose: 'verify_email', email: input.email, code: input.code });
    if (!result.ok) throw codeInvalid();
    const user = await col.users.findOne({ _id: result.otp.userId });
    if (!user || user.deletedAt || user.email !== input.email || demoSwitchedOff(deps, user)) throw codeInvalid();
    if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'Account disabled');

    const now = deps.now();
    const firstConfirmation = !user.emailVerifiedAt;
    const set: Partial<UserDoc> = { emailVerifiedAt: user.emailVerifiedAt ?? now, lastLoginAt: now, updatedAt: now };
    await col.users.updateOne({ _id: user._id }, { $set: set, $unset: { emailGrandfathered: '' } });
    const verified: UserDoc = { ...user, ...set, emailGrandfathered: undefined };
    const tokens = await createSession(deps, verified, { remember: input.remember, ...meta(c, ip) });
    setSessionCookies(c, config, tokens);
    await audit(deps, { actorId: user._id, action: 'user.verify_email', targetType: 'user', targetId: user._id });
    // A brand-new account is ready: say hello (once, in the background).
    if (firstConfirmation) deps.defer(notifyWelcome(deps, verified));
    return c.json({ user: toPublicUser(verified) });
  });

  /**
   * Sends a new code. Answers the same whether or not such an account is waiting for one,
   * including "email is not working right now" while the provider rejects messages.
   */
  app.post('/verify-email/resend', async (c) => {
    const ip = c.get('ip');
    const input = await parseJson(c, z.object({ email: emailSchema, locale: localeSchema.optional() }));
    await enforceRateLimits(deps, [
      { key: `otp:send:ip:${ip}`, limit: 20, windowSec: 3600 },
      { key: `otp:send:verify:${input.email}`, limit: 6, windowSec: 3600 },
    ]);
    if (!mailWorking(deps)) throw emailNotSent();
    const user = await col.users.findOne({ email: input.email, isActive: true, deletedAt: null });
    if (user && needsEmailVerification(user)) {
      // After the response: its timing must not tell whether such an account is waiting.
      deps.defer(
        sendEmailCode(deps, { user, purpose: 'verify_email', email: user.email, locale: input.locale ?? user.locale }).catch(
          (error: unknown) => console.error(`[mail] verify_email code failed: ${(error as Error).message}`),
        ),
      );
    }
    return c.json({ ok: true, resendAfterSec: OTP_RESEND_COOLDOWN_MS / 1000 });
  });

  // ── Refresh (rotates the refresh token) ──────────────────────────────────────
  app.post('/refresh', async (c) => {
    const ip = c.get('ip');
    await enforceRateLimits(deps, [{ key: `refresh:ip:${ip}`, limit: 120, windowSec: 60 }]);
    const token = readRefreshToken(c, config);
    if (!token) {
      clearSessionCookies(c, config);
      throw new AppError(401, 'AUTH_REQUIRED', 'No session');
    }
    const result = await rotateSession(deps, token, meta(c, ip));
    if (result.status === 'race') {
      throw new AppError(409, 'REFRESH_RACE', 'Session was refreshed concurrently; retry');
    }
    if (result.status === 'invalid') {
      clearSessionCookies(c, config);
      throw new AppError(401, 'SESSION_REVOKED', 'Session expired');
    }
    if (demoSwitchedOff(deps, result.user)) {
      await revokeSessionByToken(deps, result.tokens.refreshToken);
      clearSessionCookies(c, config);
      throw new AppError(401, 'SESSION_REVOKED', 'Session expired');
    }
    setSessionCookies(c, config, result.tokens);
    return c.json({ user: toPublicUser(result.user) });
  });

  // ── Log out ────────────────────────────────────────────────────────────────
  app.post('/logout', async (c) => {
    const token = readRefreshToken(c, config);
    if (token) await revokeSessionByToken(deps, token);
    clearSessionCookies(c, config);
    return c.json({ ok: true });
  });

  app.post('/logout-all', auth, async (c) => {
    const user = c.get('user');
    await revokeAllSessions(deps, user._id);
    clearSessionCookies(c, config);
    await audit(deps, { actorId: user._id, action: 'user.logout_all', targetType: 'user', targetId: user._id });
    return c.json({ ok: true });
  });

  app.get('/me', auth, (c) => c.json({ user: toPublicUser(c.get('user')) }));

  // ── Devices ─────────────────────────────────────────────────────────────────
  app.get('/sessions', auth, async (c) => {
    const user = c.get('user');
    // A shared demo account only ever sees its own device.
    const scope = user.isDemo === true && ObjectId.isValid(c.get('sessionId')) ? { _id: new ObjectId(c.get('sessionId')) } : {};
    const sessions = await col.sessions
      .find({ userId: user._id, revokedAt: null, expiresAt: { $gt: deps.now() }, ...scope })
      .sort({ lastUsedAt: -1 })
      .limit(20)
      .toArray();
    const current = c.get('sessionId');
    return c.json({
      sessions: sessions.map((s) => ({
        id: s._id.toHexString(),
        userAgent: s.userAgent,
        ip: s.ip,
        remember: s.remember,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s._id.toHexString() === current,
      })),
    });
  });

  app.delete('/sessions/:id', auth, async (c) => {
    const user = c.get('user');
    const id = paramId(c);
    const res = await col.sessions.updateOne(
      { _id: id, userId: user._id, revokedAt: null },
      { $set: { revokedAt: deps.now() } },
    );
    if (res.matchedCount === 0) throw new AppError(404, 'NOT_FOUND', 'Session not found');
    return c.json({ ok: true });
  });

  // ── Demo sign-in (one tap, read-only shared accounts; DEMO_LOGIN, off by default) ──
  app.post('/demo', async (c) => {
    if (config.demoRoles.length === 0) throw new AppError(404, 'NOT_FOUND', 'Not found');
    const ip = c.get('ip');
    await enforceRateLimits(deps, [{ key: `demo:ip:${ip}`, limit: 30, windowSec: 900 }]);
    const input = await parseJson(c, z.object({ role: z.enum(['client', 'admin', 'administrator']) }));
    if (!config.demoRoles.includes(input.role)) throw new AppError(404, 'NOT_FOUND', 'Demo account not available');
    return demoSession(c, input.role);
  });

  // ── Password reset ──────────────────────────────────────────────────────────
  const forgotSchema = z.object({ email: emailSchema, locale: localeSchema.optional() });

  app.post('/forgot-password', async (c) => {
    const ip = c.get('ip');
    const input = await parseJson(c, forgotSchema);
    await enforceRateLimits(deps, [
      { key: `forgot:ip:${ip}`, limit: 10, windowSec: 3600 },
      { key: `forgot:acct:${input.email}`, limit: 5, windowSec: 3600 },
    ]);

    // The same answer for every address while the provider rejects messages.
    if (!mailWorking(deps)) throw emailNotSent();
    // Shared demo accounts never get mail (their password is public anyway).
    const user = await col.users.findOne({ email: input.email, isActive: true, deletedAt: null, isDemo: { $ne: true } });
    // Everything happens after the response, so its timing never tells whether the account exists.
    if (user) {
      deps.defer(
        sendPasswordReset(user, input.locale ?? user.locale).catch((error: unknown) =>
          console.error(`[mail] password reset email failed: ${(error as Error).message}`),
        ),
      );
    }
    return c.json({ ok: true, resendAfterSec: OTP_RESEND_COOLDOWN_MS / 1000 });
  });

  /**
   * One email carries both: a 6-digit code for the app and a link for the browser. A second
   * request within a minute sends nothing new (the first email is still on its way).
   */
  async function sendPasswordReset(user: UserDoc, locale: Locale) {
    const issued = await issueOtp(deps, { userId: user._id, purpose: 'reset_password', email: user.email });
    if (issued.status !== 'issued') return;
    const now = deps.now();
    const token = randomToken(32);
    await col.passwordResets.insertOne({
      _id: new ObjectId(),
      userId: user._id,
      tokenHash: await sha256Hex(token),
      expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      usedAt: null,
      createdAt: now,
    });
    const link = `${config.appUrl}${localePrefix(locale)}/reset-password?token=${encodeURIComponent(token)}`;
    const settings = await getSettings(deps);
    await deps.mailer.send(
      passwordResetEmail({ to: user.email, name: user.name, locale, link, code: issued.code, replyTo: settings.email || undefined }),
    );
  }

  const resetSchema = z.object({
    token: z.string().min(20, 'invalid').max(200, 'invalid'),
    password: passwordSchema,
  });

  app.post('/reset-password', async (c) => {
    const ip = c.get('ip');
    await enforceRateLimits(deps, [{ key: `reset:ip:${ip}`, limit: 20, windowSec: 3600 }]);
    const input = await parseJson(c, resetSchema);
    const now = deps.now();

    const reset = await col.passwordResets.findOneAndUpdate(
      { tokenHash: await sha256Hex(input.token), usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    );
    if (!reset) throw new AppError(400, 'RESET_TOKEN_INVALID', 'Reset link is invalid or expired');

    const user = await col.users.findOne({ _id: reset.userId, isActive: true, deletedAt: null });
    if (!user) throw new AppError(400, 'RESET_TOKEN_INVALID', 'Reset link is invalid or expired');

    await setNewPassword(user, input.password, now);
    await revokeAllSessions(deps, user._id);
    clearSessionCookies(c, config);
    await audit(deps, { actorId: user._id, action: 'user.password_reset', targetType: 'user', targetId: user._id, meta: { via: 'link' } });
    return c.json({ ok: true });
  });

  /** The same reset with the 6-digit code from the email instead of the link. */
  const resetCodeSchema = z.object({ email: emailSchema, code: otpCodeSchema, password: passwordSchema });

  app.post('/reset-password/code', async (c) => {
    const ip = c.get('ip');
    const input = await parseJson(c, resetCodeSchema);
    await enforceRateLimits(deps, [
      { key: `reset:ip:${ip}`, limit: 20, windowSec: 3600 },
      { key: `otp:verify:acct:${input.email}`, limit: 15, windowSec: 900 },
    ]);
    const now = deps.now();

    const result = await verifyOtp(deps, { purpose: 'reset_password', email: input.email, code: input.code });
    if (!result.ok) throw codeInvalid();
    const user = await col.users.findOne({ _id: result.otp.userId, isActive: true, deletedAt: null });
    if (!user || user.email !== input.email || user.isDemo) throw codeInvalid();

    await setNewPassword(user, input.password, now);
    await revokeAllSessions(deps, user._id);
    clearSessionCookies(c, config);
    await audit(deps, { actorId: user._id, action: 'user.password_reset', targetType: 'user', targetId: user._id, meta: { via: 'code' } });
    return c.json({ ok: true });
  });

  /** New password; the reset (link or code) came through the inbox, so the address is proven. */
  async function setNewPassword(user: UserDoc, password: string, now: Date) {
    await col.users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: await deps.passwords.hash(password),
          emailVerifiedAt: user.emailGrandfathered ? now : (user.emailVerifiedAt ?? now),
          updatedAt: now,
        },
        $unset: { emailGrandfathered: '' },
      },
    );
    // Every other link and code for a reset stops working.
    await col.passwordResets.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: now } });
    await revokeOtps(deps, user._id, 'reset_password');
  }

  // ── Google (OpenID Connect, authorization code + PKCE) ──────────────────────
  const names = cookieNames(config);

  app.get('/google/start', async (c) => {
    const q = parseQuery(
      c,
      z.object({
        lang: localeSchema.catch('ro'),
        remember: z.enum(['0', '1']).catch('1'),
        next: z.string().max(200).optional(),
        invite: z.string().trim().max(120).optional(),
      }),
    );
    if (!config.google) {
      return c.redirect(`${config.appUrl}${localePrefix(q.lang)}/login?error=google_disabled`, 302);
    }
    await enforceRateLimits(deps, [{ key: `google:ip:${c.get('ip')}`, limit: 30, windowSec: 900 }]);

    const state = randomToken(24);
    const nonce = randomToken(24);
    const verifier = randomToken(48);
    const sealed = await sealState(
      config,
      { state, nonce, verifier, lang: q.lang, remember: q.remember === '1', next: safeNext(q.next), invite: q.invite ?? null },
      600,
    );
    setCookie(c, names.oauth, sealed, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'Lax',
      path: OAUTH_PATH,
      maxAge: 600,
    });

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await sha256Base64Url(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get('/google/callback', async (c) => {
    const sealed = getCookie(c, names.oauth);
    deleteCookie(c, names.oauth, { path: OAUTH_PATH, secure: config.cookieSecure });
    const saved = sealed ? await openState(config, sealed) : null;
    const lang: Locale = LOCALES.includes(saved?.lang as Locale) ? (saved?.lang as Locale) : 'ro';
    const fail = (reason: string) =>
      c.redirect(`${config.appUrl}${localePrefix(lang)}/login?error=${reason}`, 302);

    const google = config.google;
    if (!google || !saved) return fail('google');
    const { code, state, error } = c.req.query();
    if (error) return fail(error === 'access_denied' ? 'google_cancelled' : 'google');
    if (!code || !state || typeof saved.state !== 'string' || !timingSafeEqualStr(state, saved.state)) {
      return fail('google');
    }

    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: google.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: String(saved.verifier),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenResponse.ok) {
        // e.g. redirect_uri_mismatch / invalid_client: a console setting, worth a log line.
        console.error('[auth] google token exchange failed', tokenResponse.status, await tokenResponse.text());
        return fail('google');
      }
      const tokenBody = (await tokenResponse.json()) as { id_token?: string };
      if (!tokenBody.id_token) return fail('google');

      googleJwks ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
      const { payload } = await jwtVerify(tokenBody.id_token, googleJwks, {
        issuer: GOOGLE_ISSUERS,
        audience: google.clientId,
      });
      if (
        payload.nonce !== saved.nonce ||
        payload.email_verified !== true ||
        typeof payload.email !== 'string' ||
        typeof payload.sub !== 'string'
      ) {
        return fail('google');
      }

      const claim = typeof saved.invite === 'string' && saved.invite ? await findInvite(deps, saved.invite) : null;
      const result = await signInWithGoogle(
        deps,
        {
          sub: payload.sub,
          email: payload.email.toLowerCase(),
          givenName: typeof payload.given_name === 'string' ? payload.given_name : undefined,
          familyName: typeof payload.family_name === 'string' ? payload.family_name : undefined,
        },
        lang,
        { claim },
      );
      if (!result.ok) return fail(result.reason);
      const { user } = result;
      if (result.created || claim) deps.defer(notifyWelcome(deps, user));
      const tokens = await createSession(deps, user, {
        remember: saved.remember !== false,
        ...meta(c, c.get('ip')),
      });
      setSessionCookies(c, config, tokens);
      return c.redirect(`${config.appUrl}${localePrefix(lang)}${safeNext(String(saved.next ?? ''))}`, 302);
    } catch (callbackError) {
      console.error('[auth] google callback failed', callbackError);
      return fail('google');
    }
  });

  return app;
}
