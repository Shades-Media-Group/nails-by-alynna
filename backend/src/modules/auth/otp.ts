import { ObjectId } from 'bson';
import { z } from 'zod';
import type { AppDeps } from '../../context';
import type { OtpCodeDoc, OtpPurpose, UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { timingSafeEqualStr } from '../../lib/crypto';
import { verificationCodeEmail } from '../../lib/emails';
import { AppError } from '../../lib/errors';
import type { Locale } from '../../lib/validation';
import { getSettings } from '../settings';

/**
 * One-time email codes: 6 random digits, valid 10 minutes, 5 tries, a new one at most once a
 * minute, bound to one purpose and one address, single use. Only an HMAC of the code is
 * stored (keyed with the server secret), so a database dump cannot be brute-forced offline.
 * The newest code for a purpose replaces the older ones.
 */

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;

export const otpCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'invalid_code'));

/** Uniform 000000–999999 (rejection sampling: no modulo bias). */
export function generateOtpCode(): string {
  const limit = 4_294_000_000; // the largest multiple of 10^6 below 2^32
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const n = buf[0]!;
    if (n < limit) return String(n % 1_000_000).padStart(6, '0');
  }
}

type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const keys = new WeakMap<Uint8Array, Promise<HmacKey>>();

function hmacKey(secret: Uint8Array): Promise<HmacKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', secret as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keys.set(secret, key);
  }
  return key;
}

async function hashCode(deps: AppDeps, otp: Pick<OtpCodeDoc, 'purpose' | 'userId' | 'email'>, code: string): Promise<string> {
  const key = await hmacKey(deps.config.jwt.secret);
  const data = new TextEncoder().encode(`nba-otp:v1:${otp.purpose}:${otp.userId.toHexString()}:${otp.email}:${code}`);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type IssueResult =
  | { status: 'issued'; id: ObjectId; code: string; expiresAt: Date }
  /** `failed`: the email with the code sent under a minute ago did not go out. */
  | { status: 'cooldown'; retryAfterSec: number; failed: boolean };

/**
 * A fresh code for this purpose and address, unless one was sent there less than a minute
 * ago. (Per address: someone who corrects a typo in a new email gets a code right away.)
 */
export async function issueOtp(
  deps: AppDeps,
  opts: { userId: ObjectId; purpose: OtpPurpose; email: string },
): Promise<IssueResult> {
  const now = deps.now();
  const latest = await deps.col.otpCodes.findOne(
    { userId: opts.userId, purpose: opts.purpose, email: opts.email },
    { sort: { createdAt: -1 }, projection: { createdAt: 1, deliveryFailedAt: 1 } },
  );
  const sinceLast = latest ? now.getTime() - latest.createdAt.getTime() : Infinity;
  if (sinceLast < OTP_RESEND_COOLDOWN_MS) {
    return {
      status: 'cooldown',
      retryAfterSec: Math.ceil((OTP_RESEND_COOLDOWN_MS - sinceLast) / 1000),
      failed: Boolean(latest?.deliveryFailedAt),
    };
  }

  // Only the newest code works.
  await deps.col.otpCodes.updateMany({ userId: opts.userId, purpose: opts.purpose, usedAt: null }, { $set: { usedAt: now } });
  const code = generateOtpCode();
  const doc: OtpCodeDoc = {
    _id: new ObjectId(),
    purpose: opts.purpose,
    userId: opts.userId,
    email: opts.email,
    codeHash: '',
    attempts: 0,
    createdAt: now,
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    usedAt: null,
  };
  doc.codeHash = await hashCode(deps, doc, code);
  await deps.col.otpCodes.insertOne(doc);
  await audit(deps, { actorId: opts.userId, action: 'auth.code_sent', targetType: 'user', targetId: opts.userId, meta: { purpose: opts.purpose } });
  return { status: 'issued', id: doc._id, code, expiresAt: doc.expiresAt };
}

export type VerifyResult = { ok: true; otp: OtpCodeDoc } | { ok: false };

/**
 * Checks a code for `email` (and `userId`, when the caller is signed in). Every failure looks
 * the same to the caller: wrong, expired, used, locked or never sent.
 */
export async function verifyOtp(
  deps: AppDeps,
  opts: { purpose: OtpPurpose; email: string; code: string; userId?: ObjectId },
): Promise<VerifyResult> {
  const now = deps.now();
  const latest = await deps.col.otpCodes.findOne(
    {
      purpose: opts.purpose,
      email: opts.email,
      usedAt: null,
      expiresAt: { $gt: now },
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    { sort: { createdAt: -1 } },
  );
  if (!latest) return { ok: false };

  // The attempt is counted before comparing, so parallel guesses cannot exceed the limit.
  const counted = await deps.col.otpCodes.findOneAndUpdate(
    { _id: latest._id, usedAt: null, attempts: { $lt: OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!counted) return { ok: false };

  const expected = await hashCode(deps, counted, opts.code);
  if (!timingSafeEqualStr(expected, counted.codeHash)) {
    if (counted.attempts >= OTP_MAX_ATTEMPTS) {
      await deps.col.otpCodes.updateOne({ _id: counted._id, usedAt: null }, { $set: { usedAt: now } });
      await audit(deps, { actorId: counted.userId, action: 'auth.code_locked', targetType: 'user', targetId: counted.userId, meta: { purpose: counted.purpose } });
    }
    return { ok: false };
  }

  const used = await deps.col.otpCodes.updateOne({ _id: counted._id, usedAt: null }, { $set: { usedAt: now } });
  if (used.modifiedCount !== 1) return { ok: false };
  // Any older code for the same purpose dies with it.
  await deps.col.otpCodes.updateMany({ userId: counted.userId, purpose: counted.purpose, usedAt: null }, { $set: { usedAt: now } });
  await audit(deps, { actorId: counted.userId, action: 'auth.code_verified', targetType: 'user', targetId: counted.userId, meta: { purpose: counted.purpose } });
  return { ok: true, otp: counted };
}

/** Kills every open code of a purpose (e.g. after the password was reset another way). */
export async function revokeOtps(deps: AppDeps, userId: ObjectId, purpose: OtpPurpose): Promise<void> {
  await deps.col.otpCodes.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: deps.now() } });
}

/**
 * Password accounts of clients must prove their email before they can sign in. Google
 * accounts are proven by Google; staff (seeded or promoted) and demo accounts count as proven.
 */
export function needsEmailVerification(user: Pick<UserDoc, 'role' | 'isDemo' | 'emailVerifiedAt' | 'passwordHash'>): boolean {
  return user.role === 'client' && user.isDemo !== true && !user.emailVerifiedAt && Boolean(user.passwordHash);
}

type EmailCodeOptions = { user: UserDoc; purpose: 'verify_email' | 'change_email'; email: string; locale: Locale };

async function emailCode(deps: AppDeps, opts: EmailCodeOptions, code: string): Promise<void> {
  const settings = await getSettings(deps);
  await deps.mailer.send(
    verificationCodeEmail({
      to: opts.email,
      name: opts.user.name,
      locale: opts.locale,
      code,
      purpose: opts.purpose,
      replyTo: settings.email || undefined,
    }),
  );
}

/** 'waiting': a code went out less than a minute ago, so no new one was sent. */
export type CodeDelivery = 'sent' | 'waiting' | 'failed';

/**
 * Issues a code that confirms `email` and emails it before answering, so the app never says
 * "we sent you a code" when the provider refused the email. At most one code a minute per
 * address; within that minute the answer is what became of the previous email.
 */
export async function sendEmailCode(deps: AppDeps, opts: EmailCodeOptions): Promise<CodeDelivery> {
  const result = await issueOtp(deps, { userId: opts.user._id, purpose: opts.purpose, email: opts.email });
  if (result.status === 'cooldown') return result.failed ? 'failed' : 'waiting';
  try {
    await emailCode(deps, opts, result.code);
    return 'sent';
  } catch (error) {
    console.error(`[mail] ${opts.purpose} code email failed: ${(error as Error).message}`);
    await deps.col.otpCodes.updateOne({ _id: result.id }, { $set: { deliveryFailedAt: deps.now() } });
    return 'failed';
  }
}

/** False while the email provider is rejecting messages (see Mailer.working). */
export const mailWorking = (deps: AppDeps): boolean => deps.mailer.working?.() ?? true;

export const emailNotSent = () => new AppError(503, 'EMAIL_NOT_SENT', 'The email could not be sent. Try again in a few minutes');
