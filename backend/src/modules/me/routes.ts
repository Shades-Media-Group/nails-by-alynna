import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES } from '../../db/types';
import { audit } from '../../lib/audit';
import { emailChangedNoticeEmail } from '../../lib/emails';
import { AppError, isDuplicateKey } from '../../lib/errors';
import { isPlaceholderEmail } from '../../lib/placeholder-email';
import { enforceRateLimits } from '../../lib/rate-limit';
import { userSearch } from '../../lib/text';
import {
  emailSchema,
  localeSchema,
  parseJson,
  passwordSchema,
  personNameSchema,
  phoneSchema,
} from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { clearSessionCookies } from '../auth/cookies';
import { OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS, otpCodeSchema, sendEmailCode, verifyOtp } from '../auth/otp';
import { revokeAllSessions, toPublicUser } from '../auth/session';
import { publicPrefs, resolvePrefs } from '../notifications/prefs';
import { getSettings } from '../settings';

export function meRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  const updateSchema = z
    .object({
      name: personNameSchema,
      surname: personNameSchema,
      phone: phoneSchema,
      locale: localeSchema,
    })
    .partial();

  app.patch('/', async (c) => {
    const user = c.get('user');
    const input = await parseJson(c, updateSchema);
    const next = { ...user, ...input };
    const now = deps.now();
    const set = {
      ...input,
      search: userSearch(next.name, next.surname, next.email, next.phone),
      updatedAt: now,
    };
    await deps.col.users.updateOne({ _id: user._id }, { $set: set });
    return c.json({ user: toPublicUser({ ...next, updatedAt: now }) });
  });

  const passwordChangeSchema = z.object({
    currentPassword: z.string().max(128).optional(),
    newPassword: passwordSchema,
  });

  app.post('/password', async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `pwchange:user:${user._id.toHexString()}`, limit: 10, windowSec: 900 }]);
    const input = await parseJson(c, passwordChangeSchema);
    if (user.passwordHash) {
      const check = await deps.passwords.verify(input.currentPassword ?? '', user.passwordHash);
      if (!check.ok) {
        throw new AppError(422, 'WRONG_PASSWORD', 'Current password is incorrect', {
          fields: { currentPassword: 'wrong' },
        });
      }
    }
    const now = deps.now();
    await deps.col.users.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await deps.passwords.hash(input.newPassword), updatedAt: now } },
    );
    // Other devices must sign in again; this device keeps working after a refresh.
    const current = c.get('sessionId');
    await deps.col.sessions.updateMany(
      { userId: user._id, revokedAt: null, ...(ObjectId.isValid(current) ? { _id: { $ne: new ObjectId(current) } } : {}) },
      { $set: { revokedAt: now } },
    );
    await audit(deps, { actorId: user._id, action: 'user.password_change', targetType: 'user', targetId: user._id });
    return c.json({ ok: true });
  });

  // ── Change email: a code goes to the new address; entering it switches the account over ──
  const emailChangeSchema = z.object({
    email: emailSchema,
    /** Required when the account has a password (a stolen session alone cannot move the account). */
    password: z.string().max(128).optional(),
    locale: localeSchema.optional(),
  });

  app.post('/email', async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [
      { key: `email-change:user:${user._id.toHexString()}`, limit: 6, windowSec: 3600 },
      { key: `otp:send:ip:${c.get('ip')}`, limit: 20, windowSec: 3600 },
    ]);
    const input = await parseJson(c, emailChangeSchema);
    if (input.email === user.email) {
      throw new AppError(422, 'VALIDATION_ERROR', 'That is already your email', { fields: { email: 'same_email' } });
    }
    if (user.passwordHash) {
      const check = await deps.passwords.verify(input.password ?? '', user.passwordHash);
      if (!check.ok) {
        throw new AppError(422, 'WRONG_PASSWORD', 'Password is incorrect', { fields: { password: 'wrong' } });
      }
    }
    const taken = await deps.col.users.findOne({ email: input.email, _id: { $ne: user._id } }, { projection: { _id: 1 } });
    if (taken) throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { email: 'taken' } });

    await sendEmailCode(deps, { user, purpose: 'change_email', email: input.email, locale: input.locale ?? user.locale });
    return c.json({ verification: { email: input.email, expiresInSec: OTP_TTL_MS / 1000, resendAfterSec: OTP_RESEND_COOLDOWN_MS / 1000 } });
  });

  /** Another code for the address started above (no password again: the first step proved it). */
  app.post('/email/resend', async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `email-change:user:${user._id.toHexString()}`, limit: 6, windowSec: 3600 }]);
    const input = await parseJson(c, z.object({ email: emailSchema, locale: localeSchema.optional() }));
    const pending = await deps.col.otpCodes.findOne({
      userId: user._id,
      purpose: 'change_email',
      email: input.email,
      createdAt: { $gt: new Date(deps.now().getTime() - OTP_TTL_MS) },
    });
    if (pending) await sendEmailCode(deps, { user, purpose: 'change_email', email: input.email, locale: input.locale ?? user.locale });
    return c.json({ ok: true, resendAfterSec: OTP_RESEND_COOLDOWN_MS / 1000 });
  });

  app.post('/email/verify', async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `otp:verify:user:${user._id.toHexString()}`, limit: 15, windowSec: 900 }]);
    const input = await parseJson(c, z.object({ email: emailSchema, code: otpCodeSchema }));
    const result = await verifyOtp(deps, { purpose: 'change_email', email: input.email, code: input.code, userId: user._id });
    if (!result.ok) {
      throw new AppError(400, 'CODE_INVALID', 'The code is wrong or has expired', { fields: { code: 'invalid_code' } });
    }

    const now = deps.now();
    const previous = user.email;
    const set = {
      email: input.email,
      emailVerifiedAt: now,
      search: userSearch(user.name, user.surname, input.email, user.phone),
      updatedAt: now,
    };
    try {
      await deps.col.users.updateOne({ _id: user._id }, { $set: set, $unset: { emailGrandfathered: '' } });
    } catch (error) {
      if (isDuplicateKey(error)) throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { email: 'taken' } });
      throw error;
    }
    await audit(deps, { actorId: user._id, action: 'user.email_change', targetType: 'user', targetId: user._id });

    // A heads-up to the old address, in case this was not its owner.
    if (!isPlaceholderEmail(previous)) {
      deps.defer(
        (async () => {
          const settings = await getSettings(deps);
          await deps.mailer.send(
            emailChangedNoticeEmail({ to: previous, name: user.name, locale: user.locale, newEmail: input.email, replyTo: settings.email || undefined }),
          );
        })().catch((error: unknown) => console.error(`[mail] email-changed notice failed: ${(error as Error).message}`)),
      );
    }
    return c.json({ user: toPublicUser({ ...user, ...set, emailGrandfathered: undefined }) });
  });

  /** GDPR data portability: everything we hold about the signed-in user, as a JSON download. */
  app.get('/export', async (c) => {
    const user = c.get('user');
    const [appointments, sessions, pushDevices] = await Promise.all([
      deps.col.appointments.find({ clientId: user._id }).sort({ start: -1 }).toArray(),
      deps.col.sessions.find({ userId: user._id, revokedAt: null }).toArray(),
      deps.col.pushSubscriptions.find({ userId: user._id }, { projection: { userAgent: 1, createdAt: 1, lastSuccessAt: 1 } }).toArray(),
    ]);
    const now = deps.now();
    const body = {
      exportedAt: now.toISOString(),
      controller: 'Nails by Alynna, Chișinău, Republic of Moldova',
      profile: toPublicUser(user),
      appointments: appointments.map((a) => ({
        code: a.code,
        status: a.status,
        start: a.start.toISOString(),
        end: a.end.toISOString(),
        services: a.services.map((s) => ({ name: s.name, durationMin: s.durationMin, price: s.price })),
        totalPrice: a.totalPrice,
        notes: a.notes,
        createdAt: a.createdAt.toISOString(),
        cancelledAt: a.cancelledAt?.toISOString() ?? null,
      })),
      devices: sessions.map((s) => ({
        userAgent: s.userAgent,
        approximateIp: s.ip,
        signedInAt: s.createdAt.toISOString(),
        lastActiveAt: s.lastUsedAt.toISOString(),
      })),
      notifications: {
        preferences: publicPrefs(resolvePrefs(user.notificationPrefs)),
        pushDevices: pushDevices.map((d) => ({
          userAgent: d.userAgent,
          enabledAt: d.createdAt.toISOString(),
          lastDeliveredAt: d.lastSuccessAt?.toISOString() ?? null,
        })),
      },
    };
    c.header('Content-Disposition', `attachment; filename="nails-by-alynna-data-${now.toISOString().slice(0, 10)}.json"`);
    return c.json(body);
  });

  /**
   * Account deletion keeps visit history for the studio's records but removes personal
   * data: contact details are anonymised and upcoming appointments are cancelled.
   */
  app.delete('/', async (c) => {
    const user = c.get('user');
    const input = await parseJson(c, z.object({ password: z.string().max(128).optional() }));
    if (user.role !== 'client') {
      throw new AppError(403, 'FORBIDDEN', 'Staff accounts are removed by an administrator');
    }
    if (user.passwordHash) {
      const check = await deps.passwords.verify(input.password ?? '', user.passwordHash);
      if (!check.ok) {
        throw new AppError(422, 'WRONG_PASSWORD', 'Password is incorrect', { fields: { password: 'wrong' } });
      }
    }
    const now = deps.now();
    const anonymousEmail = `deleted+${user._id.toHexString()}@invalid.local`;
    await deps.col.appointments.updateMany(
      { clientId: user._id, status: { $in: ACTIVE_STATUSES }, start: { $gt: now } },
      { $set: { status: 'cancelled', cancelledAt: now, cancelledBy: 'client', cancelReason: 'account_deleted', updatedAt: now } },
    );
    await deps.col.appointments.updateMany(
      { clientId: user._id },
      { $set: { client: { name: 'Deleted', surname: 'client', phone: null, email: anonymousEmail } } },
    );
    await deps.col.users.updateOne(
      { _id: user._id },
      {
        $set: {
          email: anonymousEmail,
          name: 'Deleted',
          surname: 'client',
          phone: null,
          passwordHash: null,
          googleId: null,
          emailVerifiedAt: null,
          isActive: false,
          notes: '',
          search: '',
          deletedAt: now,
          updatedAt: now,
        },
        $unset: { notificationPrefs: '', emailGrandfathered: '' },
      },
    );
    await Promise.all([
      deps.col.pushSubscriptions.deleteMany({ userId: user._id }),
      deps.col.otpCodes.deleteMany({ userId: user._id }),
    ]);
    await revokeAllSessions(deps, user._id);
    clearSessionCookies(c, deps.config);
    await audit(deps, { actorId: user._id, action: 'user.delete_self', targetType: 'user', targetId: user._id });
    return c.json({ ok: true });
  });

  return app;
}
