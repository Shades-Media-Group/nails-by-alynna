import { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { InviteDoc, UserDoc } from '../../db/types';
import { randomToken, sha256Hex } from '../../lib/crypto';

export const INVITE_TTL_MS = 14 * 86_400_000;

/** A client record staff created (walk-in) that nobody signs in to yet. */
export function canBeClaimed(user: Pick<UserDoc, 'role' | 'passwordHash' | 'googleId' | 'deletedAt' | 'isActive' | 'isDemo'>): boolean {
  return user.role === 'client' && !user.passwordHash && !user.googleId && !user.deletedAt && user.isActive && user.isDemo !== true;
}

/** Issues a fresh single-use link for a walk-in client; earlier unused links stop working. */
export async function createInvite(deps: AppDeps, client: UserDoc, createdBy: ObjectId) {
  const now = deps.now();
  await deps.col.invites.updateMany({ userId: client._id, usedAt: null }, { $set: { usedAt: now } });
  const token = randomToken(32);
  const doc: InviteDoc = {
    _id: new ObjectId(),
    userId: client._id,
    tokenHash: await sha256Hex(token),
    createdBy,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    usedAt: null,
  };
  await deps.col.invites.insertOne(doc);
  return { token, expiresAt: doc.expiresAt };
}

/** The invite and its client when the link is still good; null otherwise (never says why). */
export async function findInvite(deps: AppDeps, token: string): Promise<{ invite: InviteDoc; user: UserDoc } | null> {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const invite = await deps.col.invites.findOne({ tokenHash: await sha256Hex(token), usedAt: null, expiresAt: { $gt: deps.now() } });
  if (!invite) return null;
  const user = await deps.col.users.findOne({ _id: invite.userId });
  if (!user || !canBeClaimed(user)) return null;
  return { invite, user };
}

/** Marks the invite used; only one of two simultaneous claims wins. */
export async function consumeInvite(deps: AppDeps, invite: InviteDoc): Promise<boolean> {
  const res = await deps.col.invites.updateOne({ _id: invite._id, usedAt: null }, { $set: { usedAt: deps.now() } });
  return res.modifiedCount === 1;
}
