import { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { InviteDoc, UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { isDuplicateKey } from '../../lib/errors';
import { truncate, userSearch } from '../../lib/text';
import type { Locale } from '../../lib/validation';
import { consumeInvite } from './invites';
import { revokeAllSessions } from './session';

/** The verified claims of a Google ID token that sign-in needs. */
export interface GoogleIdentity {
  sub: string;
  /** Lower-cased; Google has verified it (`email_verified: true`). */
  email: string;
  givenName?: string;
  familyName?: string;
}

export type GoogleSignIn =
  | { ok: true; user: UserDoc; created: boolean }
  | { ok: false; reason: 'google' | 'google_conflict' | 'account_disabled' };

/**
 * Finds, links or creates the account for a Google identity (sign-in and sign-up are the
 * same step). Linking by email is safe because Google verified the address, with one guard
 * against pre-account hijacking: if the matching account was self-registered with a password
 * and its email was never proven, whoever set that password may not own the inbox. The
 * password and every open session are dropped, as Firebase does; the owner keeps Google and
 * can set a new password through "Forgot password".
 */
export async function signInWithGoogle(
  deps: AppDeps,
  identity: GoogleIdentity,
  locale: Locale,
  options: { claim?: { invite: InviteDoc; user: UserDoc } | null } = {},
): Promise<GoogleSignIn> {
  const { col } = deps;
  const now = deps.now();

  const linked = await col.users.findOne({ googleId: identity.sub });
  if (linked) {
    if (!linked.isActive || linked.deletedAt) return { ok: false, reason: 'account_disabled' };
    await col.users.updateOne({ _id: linked._id }, { $set: { lastLoginAt: now } });
    return { ok: true, user: { ...linked, lastLoginAt: now }, created: false };
  }

  const byEmail = await col.users.findOne({ email: identity.email });
  if (byEmail) {
    if (byEmail.isDemo) return { ok: false, reason: 'google' };
    if (byEmail.googleId) return { ok: false, reason: 'google_conflict' };
    if (!byEmail.isActive || byEmail.deletedAt) return { ok: false, reason: 'account_disabled' };

    // Accounts marked verified only because they predate email codes are still unproven here.
    const unprovenPassword = byEmail.passwordHash !== null && (!byEmail.emailVerifiedAt || byEmail.emailGrandfathered === true);
    if (unprovenPassword) await revokeAllSessions(deps, byEmail._id);
    const set: Partial<UserDoc> = {
      googleId: identity.sub,
      emailVerifiedAt: byEmail.emailVerifiedAt && !byEmail.emailGrandfathered ? byEmail.emailVerifiedAt : now,
      lastLoginAt: now,
      updatedAt: now,
      ...(unprovenPassword ? { passwordHash: null } : {}),
    };
    await col.users.updateOne({ _id: byEmail._id }, { $set: set, $unset: { emailGrandfathered: '' } });
    await audit(deps, {
      actorId: byEmail._id,
      action: 'user.link_google',
      targetType: 'user',
      targetId: byEmail._id,
      meta: { passwordRemoved: unprovenPassword },
    });
    const tokenVersion = unprovenPassword ? byEmail.tokenVersion + 1 : byEmail.tokenVersion;
    return { ok: true, user: { ...byEmail, ...set, emailGrandfathered: undefined, tokenVersion }, created: false };
  }

  // Opened from a studio invite: the walk-in record becomes this Google account, bookings included.
  if (options.claim && (await consumeInvite(deps, options.claim.invite))) {
    const invited = options.claim.user;
    const set: Partial<UserDoc> = {
      email: identity.email,
      googleId: identity.sub,
      emailVerifiedAt: now,
      termsAcceptedAt: now,
      // Staff typed the name at the desk; Google fills it in only if it was left empty.
      name: invited.name || truncate(identity.givenName?.trim() || 'Client', 60),
      surname: invited.surname || truncate(identity.familyName?.trim() ?? '', 60),
      lastLoginAt: now,
      updatedAt: now,
    };
    set.search = userSearch(set.name!, set.surname!, identity.email, invited.phone);
    await col.users.updateOne({ _id: invited._id }, { $set: set, $unset: { emailGrandfathered: '' } });
    await audit(deps, { actorId: invited._id, action: 'user.claim_invite_google', targetType: 'user', targetId: invited._id });
    return { ok: true, user: { ...invited, ...set }, created: false };
  }

  const name = truncate(identity.givenName?.trim() || identity.email.split('@')[0] || 'Client', 60);
  const surname = truncate(identity.familyName?.trim() ?? '', 60);
  const user: UserDoc = {
    _id: new ObjectId(),
    email: identity.email,
    name,
    surname,
    phone: null,
    role: 'client',
    locale,
    passwordHash: null,
    googleId: identity.sub,
    emailVerifiedAt: now,
    // The Google button sits under "By continuing you agree to the Terms and Privacy policy".
    termsAcceptedAt: now,
    isActive: true,
    bookingBlocked: false,
    tokenVersion: 0,
    notes: '',
    search: userSearch(name, surname, identity.email, null),
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  try {
    await col.users.insertOne(user);
  } catch (error) {
    // Two callbacks for the same new account raced; the other one won.
    if (isDuplicateKey(error)) return { ok: false, reason: 'google' };
    throw error;
  }
  await audit(deps, { actorId: user._id, action: 'user.register_google', targetType: 'user', targetId: user._id });
  return { ok: true, user, created: true };
}
