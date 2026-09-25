import { ObjectId } from 'mongodb';
import type { AppDeps } from '../../context';
import type { SessionDoc, UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { randomToken, sha256Hex } from '../../lib/crypto';
import { signAccessToken } from '../../lib/jwt';
import { maskIp, truncate } from '../../lib/text';

/** A rotated refresh token presented again within this window is a benign race, not theft. */
const REFRESH_RACE_GRACE_MS = 30_000;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  remember: boolean;
  sessionId: ObjectId;
}

function sessionExpiry(deps: AppDeps, remember: boolean, from: Date): Date {
  const ms = remember
    ? deps.config.session.rememberDays * 86_400_000
    : deps.config.session.sessionHours * 3_600_000;
  return new Date(from.getTime() + ms);
}

export async function createSession(
  deps: AppDeps,
  user: UserDoc,
  meta: { remember: boolean; userAgent?: string; ip?: string },
): Promise<IssuedTokens> {
  const now = deps.now();
  const refreshToken = randomToken(32);
  const session: SessionDoc = {
    _id: new ObjectId(),
    userId: user._id,
    tokenHash: await sha256Hex(refreshToken),
    prevTokenHash: null,
    rotatedAt: null,
    remember: meta.remember,
    userAgent: truncate(meta.userAgent, 200),
    ip: maskIp(meta.ip),
    createdAt: now,
    lastUsedAt: now,
    expiresAt: sessionExpiry(deps, meta.remember, now),
    revokedAt: null,
  };
  await deps.col.sessions.insertOne(session);

  const accessToken = await signAccessToken(deps.config, {
    sub: user._id.toHexString(),
    sid: session._id.toHexString(),
    role: user.role,
    tv: user.tokenVersion,
  }, now);
  return { accessToken, refreshToken, remember: meta.remember, sessionId: session._id };
}

export type RotateResult =
  | { status: 'ok'; tokens: IssuedTokens; user: UserDoc }
  | { status: 'race' }
  | { status: 'invalid' };

/**
 * Refresh-token rotation with reuse detection: every refresh swaps the token; presenting
 * an already-rotated token after the grace window revokes the whole session.
 */
export async function rotateSession(
  deps: AppDeps,
  refreshToken: string,
  meta: { userAgent?: string; ip?: string },
): Promise<RotateResult> {
  const now = deps.now();
  const hash = await sha256Hex(refreshToken);
  const nextToken = randomToken(32);
  const nextHash = await sha256Hex(nextToken);

  const current = await deps.col.sessions.findOne({ tokenHash: hash });
  if (current && !current.revokedAt && current.expiresAt > now) {
    const updated = await deps.col.sessions.findOneAndUpdate(
      { _id: current._id, tokenHash: hash, revokedAt: null },
      {
        $set: {
          tokenHash: nextHash,
          prevTokenHash: hash,
          rotatedAt: now,
          lastUsedAt: now,
          expiresAt: sessionExpiry(deps, current.remember, now),
          userAgent: truncate(meta.userAgent, 200) || current.userAgent,
          ip: maskIp(meta.ip) || current.ip,
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) return { status: 'race' };

    const user = await deps.col.users.findOne({ _id: updated.userId });
    if (!user || !user.isActive || user.deletedAt) {
      await revokeSession(deps, updated._id);
      return { status: 'invalid' };
    }
    const accessToken = await signAccessToken(deps.config, {
      sub: user._id.toHexString(),
      sid: updated._id.toHexString(),
      role: user.role,
      tv: user.tokenVersion,
    }, now);
    return {
      status: 'ok',
      user,
      tokens: { accessToken, refreshToken: nextToken, remember: updated.remember, sessionId: updated._id },
    };
  }

  const previous = await deps.col.sessions.findOne({ prevTokenHash: hash });
  if (previous && !previous.revokedAt) {
    const rotatedAgo = previous.rotatedAt ? now.getTime() - previous.rotatedAt.getTime() : Infinity;
    if (rotatedAgo <= REFRESH_RACE_GRACE_MS) return { status: 'race' };
    // An old token came back long after rotation: assume it was stolen.
    await revokeSession(deps, previous._id);
    await audit(deps, {
      actorId: previous.userId,
      action: 'session.reuse_detected',
      targetType: 'session',
      targetId: previous._id,
      meta: { ip: maskIp(meta.ip) },
    });
  }
  return { status: 'invalid' };
}

export async function revokeSession(deps: AppDeps, sessionId: ObjectId): Promise<void> {
  await deps.col.sessions.updateOne(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: deps.now() } },
  );
}

export async function revokeSessionByToken(deps: AppDeps, refreshToken: string): Promise<void> {
  const hash = await sha256Hex(refreshToken);
  await deps.col.sessions.updateOne(
    { tokenHash: hash, revokedAt: null },
    { $set: { revokedAt: deps.now() } },
  );
}

/** Signs the user out everywhere: revokes sessions and invalidates live access tokens. */
export async function revokeAllSessions(deps: AppDeps, userId: ObjectId): Promise<void> {
  const now = deps.now();
  await deps.col.sessions.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } });
  await deps.col.users.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 }, $set: { updatedAt: now } });
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  surname: string;
  phone: string | null;
  role: UserDoc['role'];
  locale: UserDoc['locale'];
  hasPassword: boolean;
  hasGoogle: boolean;
  bookingBlocked: boolean;
  isDemo: boolean;
  createdAt: string;
}

export function toPublicUser(user: UserDoc): PublicUser {
  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    surname: user.surname,
    phone: user.phone,
    role: user.role,
    locale: user.locale,
    hasPassword: Boolean(user.passwordHash),
    hasGoogle: Boolean(user.googleId),
    bookingBlocked: user.bookingBlocked,
    isDemo: user.isDemo === true,
    createdAt: user.createdAt.toISOString(),
  };
}
