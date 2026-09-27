import { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { UserDoc, WalletPassDoc } from '../../db/types';
import { base64UrlEncode, randomToken, timingSafeEqualStr } from '../../lib/crypto';
import { isDuplicateKey } from '../../lib/errors';
import type { Locale } from '../../lib/validation';
import { cardUrl, ensureMemberCode, loyaltyStatus, type LoyaltyStatus } from '../loyalty/service';
import { getSettings } from '../settings';

/*
 * The loyalty card as a Wallet pass: Apple Wallet (apple.ts) and Google Wallet (google.ts). Each
 * one is on once its settings are in the environment (config.ts); until then the app says it is
 * coming. A pass holds the card as it was when it was added. Keeping passes up to date is a later
 * step: Apple's pass web service with APNs pushes, Google's REST API (PATCH the object).
 */

export interface WalletStatus {
  apple: boolean;
  google: boolean;
}

export function walletStatus(deps: AppDeps): WalletStatus {
  const { apple, google } = deps.config.wallet;
  // An expired pass certificate makes passes Wallet refuses: off until a new one is in.
  return { apple: Boolean(apple && apple.certificateExpiresAt > deps.now()), google: Boolean(google) };
}

/** The client's pass record, made the first time they add the card: the same card every time. */
export async function walletPassFor(deps: AppDeps, userId: ObjectId): Promise<WalletPassDoc> {
  const existing = await deps.col.walletPasses.findOne({ _id: userId });
  if (existing) return existing;
  const doc: WalletPassDoc = {
    _id: userId,
    serialNumber: crypto.randomUUID(),
    authenticationToken: randomToken(24),
    createdAt: deps.now(),
    appleIssuedAt: null,
    googleIssuedAt: null,
  };
  try {
    await deps.col.walletPasses.insertOne(doc);
    return doc;
  } catch (error) {
    // Two taps at the same moment: the first record wins.
    if (!isDuplicateKey(error)) throw error;
    const first = await deps.col.walletPasses.findOne({ _id: userId });
    if (!first) throw error;
    return first;
  }
}

export async function markIssued(deps: AppDeps, userId: ObjectId, wallet: 'apple' | 'google'): Promise<void> {
  const now = deps.now();
  await deps.col.walletPasses.updateOne({ _id: userId }, { $set: wallet === 'apple' ? { appleIssuedAt: now } : { googleIssuedAt: now } });
}

/** What a pass shows: the client's card as it is now, in the client's language. */
export interface CardSnapshot {
  studio: { name: string; address: string; phone: string };
  name: string;
  locale: Locale;
  memberCode: string;
  cardUrl: string;
  appUrl: string;
  loyalty: LoyaltyStatus;
  serialNumber: string;
  at: Date;
}

export async function cardSnapshot(deps: AppDeps, user: UserDoc): Promise<CardSnapshot> {
  const [settings, memberCode, pass] = await Promise.all([
    getSettings(deps),
    ensureMemberCode(deps, user),
    walletPassFor(deps, user._id),
  ]);
  const loyalty = await loyaltyStatus(deps, user, settings);
  return {
    studio: {
      name: settings.name,
      address: [settings.address, settings.city].map((part) => part.trim()).filter(Boolean).join(', '),
      phone: settings.phone,
    },
    name: `${user.name} ${user.surname}`.trim(),
    locale: user.locale,
    memberCode,
    cardUrl: cardUrl(deps.config.appUrl, memberCode),
    appUrl: deps.config.appUrl,
    loyalty,
    serialNumber: pass.serialNumber,
    at: deps.now(),
  };
}

/** "K7QM 2XRP", as the app shows the code. */
export const groupedCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

// ── Signed pass links ────────────────────────────────────────────────────────
/*
 * The app opens the pass file through a short-lived signed link rather than behind the session
 * cookie: in the installed iPhone app the file opens in a separate view that may not carry the
 * app's cookies (as with calendar files, modules/calendar).
 */
const LINK_TTL_SEC = 10 * 60;
const encoder = new TextEncoder();

async function hmac(secret: Uint8Array, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`wallet:${payload}`));
  return base64UrlEncode(new Uint8Array(signature));
}

/** The app-relative path of the client's pass file, valid for ten minutes. */
export async function applePassPath(deps: AppDeps, userId: ObjectId): Promise<string> {
  const exp = Math.floor(deps.now().getTime() / 1000) + LINK_TTL_SEC;
  const payload = `${userId.toHexString()}.${exp}`;
  return `/api/wallet/apple/pass/${payload}.${await hmac(deps.config.jwt.secret, payload)}.pkpass`;
}

export async function verifyPassToken(deps: AppDeps, token: string): Promise<ObjectId | null> {
  const match = /^([a-f0-9]{24})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, id, exp, signature] = match as unknown as [string, string, string, string];
  if (Number(exp) * 1000 < deps.now().getTime()) return null;
  const payload = `${id}.${exp}`;
  for (const secret of [deps.config.jwt.secret, deps.config.jwt.previousSecret]) {
    if (secret && timingSafeEqualStr(await hmac(secret, payload), signature)) return new ObjectId(id);
  }
  return null;
}
