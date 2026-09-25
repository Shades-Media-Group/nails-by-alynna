import { ObjectId, type Filter } from 'mongodb';
import type { AppDeps } from '../../context';
import {
  ACTIVE_STATUSES,
  type AppointmentDoc,
  type AppointmentLoyalty,
  type LoyaltyReward,
  type StudioSettings,
  type UserDoc,
} from '../../db/types';

/*
 * Loyalty stamp card. Every completed visit is a stamp; the studio sets how many visits make a
 * card and which of them carry a discount (by default the 4th visit is 15% off, the 8th 50% off,
 * then a new card starts). Staff can add or remove stamps by hand for visits outside the app.
 *
 * A completed visit keeps the stamp it earned (position on the card + discount), so later
 * changes to the rules or the history never rewrite what a client already paid. Upcoming visits
 * show the stamp they are expected to earn, which shifts if an earlier visit is cancelled.
 */

export interface LoyaltyRules {
  enabled: boolean;
  cycle: number;
  rewards: LoyaltyReward[];
}

/** What an appointment earns (completed) or is expected to earn (upcoming). */
export interface LoyaltyTag extends AppointmentLoyalty {
  predicted: boolean;
}

export interface LoyaltyStatus {
  enabled: boolean;
  cycle: number;
  rewards: LoyaltyReward[];
  /** Completed visits plus stamps added by staff. */
  visits: number;
  /** Stamps on the current card, 0..cycle-1. */
  stamps: number;
  /** Which card the client is on, from 1. */
  card: number;
  /** The next discount: on which visit of the card, and how many visits from now (1 = the next). */
  nextReward: (LoyaltyReward & { inVisits: number }) | null;
  /** Discounts already used, newest first. */
  history: Array<{ appointmentId: string; date: string; visit: number; percent: number; discount: number }>;
}

export function rulesFrom(settings: StudioSettings): LoyaltyRules {
  const cycle = Math.max(2, Math.floor(settings.loyaltyCycle || 8));
  const rewards = (settings.loyaltyRewards ?? [])
    .filter((r) => r.visit >= 1 && r.visit <= cycle && r.percent > 0)
    .sort((a, b) => a.visit - b.visit);
  return { enabled: settings.loyaltyEnabled !== false, cycle, rewards };
}

/** Position on the card (1..cycle) of the visit that follows `visitsBefore` earlier ones. */
export function positionAfter(rules: LoyaltyRules, visitsBefore: number): number {
  return (Math.max(0, visitsBefore) % rules.cycle) + 1;
}

export function rewardPercent(rules: LoyaltyRules, position: number): number {
  return rules.rewards.find((r) => r.visit === position)?.percent ?? 0;
}

export function discountFor(price: number, percent: number): number {
  return Math.round((price * percent) / 100);
}

/** The stamp a visit earns when `visitsBefore` visits came before it. */
export function stampFor(rules: LoyaltyRules, visitsBefore: number, price: number): AppointmentLoyalty {
  const visit = positionAfter(rules, visitsBefore);
  const percent = rewardPercent(rules, visit);
  return { visit, cycle: rules.cycle, percent, discount: discountFor(price, percent) };
}

/** The next discount after `visits` stamps, looking at most one full card ahead. */
export function nextReward(rules: LoyaltyRules, visits: number): LoyaltyStatus['nextReward'] {
  if (rules.rewards.length === 0) return null;
  for (let k = 1; k <= rules.cycle; k++) {
    const visit = positionAfter(rules, visits + k - 1);
    const percent = rewardPercent(rules, visit);
    if (percent > 0) return { visit, percent, inVisits: k };
  }
  return null;
}

// ── Member codes ─────────────────────────────────────────────────────────────
/** No 0/O, 1/I/L: easy to read out loud and to type from a screen. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function newMemberCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 % 31 leaves a tiny bias; irrelevant for an identifier that is not a secret.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * The code from whatever staff scanned or typed: the card URL (…/c/CODE), the code with
 * spaces or dashes, any letter case. Null when it can't be a member code.
 */
export function normalizeMemberCode(input: string): string | null {
  const fromUrl = /\/c\/([A-Za-z0-9-]+)/.exec(input)?.[1];
  const raw = (fromUrl ?? input).toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!ALPHABET.includes(ch)) return null;
  return raw;
}

export function cardUrl(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/$/, '')}/c/${code}`;
}

/** The client's member code, issued on first use (unique; retried on the rare collision). */
export async function ensureMemberCode(deps: AppDeps, user: Pick<UserDoc, '_id' | 'memberCode'>): Promise<string> {
  if (user.memberCode) return user.memberCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newMemberCode();
    try {
      const res = await deps.col.users.updateOne(
        { _id: user._id, memberCode: { $exists: false } },
        { $set: { memberCode: code } },
      );
      if (res.modifiedCount === 1) return code;
      // Someone else (another tab) issued it meanwhile: use theirs.
      const fresh = await deps.col.users.findOne({ _id: user._id }, { projection: { memberCode: 1 } });
      if (fresh?.memberCode) return fresh.memberCode;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  throw new Error('Could not issue a member code');
}

// ── Counting ─────────────────────────────────────────────────────────────────
/** Completed visits per client (optionally leaving one appointment out). */
export async function completedVisits(
  deps: AppDeps,
  clientIds: ObjectId[],
  exclude?: ObjectId,
): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();
  const match: Filter<AppointmentDoc> = { clientId: { $in: clientIds }, status: 'completed' };
  if (exclude) match._id = { $ne: exclude };
  const rows = await deps.col.appointments
    .aggregate<{ _id: ObjectId; n: number }>([{ $match: match }, { $group: { _id: '$clientId', n: { $sum: 1 } } }])
    .toArray();
  return new Map(rows.map((r) => [r._id.toHexString(), r.n]));
}

async function bonuses(deps: AppDeps, clientIds: ObjectId[]): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();
  const users = await deps.col.users
    .find({ _id: { $in: clientIds } }, { projection: { loyaltyBonus: 1 } })
    .toArray();
  return new Map(users.map((u) => [u._id.toHexString(), u.loyaltyBonus ?? 0]));
}

const uniqueIds = (ids: ObjectId[]) => [...new Set(ids.map((id) => id.toHexString()))].map((id) => new ObjectId(id));

/** The stamp to record when `appointment` is completed now. */
export async function stampOnCompletion(
  deps: AppDeps,
  appointment: AppointmentDoc,
  settings: StudioSettings,
): Promise<AppointmentLoyalty | null> {
  const rules = rulesFrom(settings);
  if (!rules.enabled) return null;
  const [done, bonus] = await Promise.all([
    completedVisits(deps, [appointment.clientId], appointment._id),
    bonuses(deps, [appointment.clientId]),
  ]);
  const key = appointment.clientId.toHexString();
  const before = Math.max(0, (done.get(key) ?? 0) + (bonus.get(key) ?? 0));
  return stampFor(rules, before, appointment.totalPrice);
}

/**
 * Loyalty tags for a list of appointments: the stamp a completed visit earned, and for
 * visits still to come (pending/confirmed) the stamp each is expected to earn, in date order
 * after the client's completed visits.
 */
export async function loyaltyTags(
  deps: AppDeps,
  docs: AppointmentDoc[],
  settings: StudioSettings,
): Promise<Map<string, LoyaltyTag>> {
  const tags = new Map<string, LoyaltyTag>();
  for (const doc of docs) {
    if (doc.status === 'completed' && doc.loyalty) tags.set(doc._id.toHexString(), { ...doc.loyalty, predicted: false });
  }
  const rules = rulesFrom(settings);
  const upcoming = docs.filter((d) => ACTIVE_STATUSES.includes(d.status));
  if (!rules.enabled || upcoming.length === 0) return tags;

  const clientIds = uniqueIds(upcoming.map((d) => d.clientId));
  const [done, bonus, active] = await Promise.all([
    completedVisits(deps, clientIds),
    bonuses(deps, clientIds),
    deps.col.appointments
      .find(
        { clientId: { $in: clientIds }, status: { $in: ACTIVE_STATUSES } },
        { projection: { _id: 1, clientId: 1 } },
      )
      .sort({ start: 1, _id: 1 })
      .toArray(),
  ]);
  const wanted = new Map(upcoming.map((d) => [d._id.toHexString(), d]));
  const seen = new Map<string, number>();
  for (const row of active) {
    const client = row.clientId.toHexString();
    const k = seen.get(client) ?? 0;
    seen.set(client, k + 1);
    const doc = wanted.get(row._id.toHexString());
    if (!doc) continue;
    const before = Math.max(0, (done.get(client) ?? 0) + (bonus.get(client) ?? 0)) + k;
    tags.set(row._id.toHexString(), { ...stampFor(rules, before, doc.totalPrice), predicted: true });
  }
  return tags;
}

export async function loyaltyStatus(
  deps: AppDeps,
  user: Pick<UserDoc, '_id' | 'loyaltyBonus'>,
  settings: StudioSettings,
): Promise<LoyaltyStatus> {
  const rules = rulesFrom(settings);
  const [done, used] = await Promise.all([
    completedVisits(deps, [user._id]),
    deps.col.appointments
      .find({ clientId: user._id, status: 'completed', 'loyalty.percent': { $gt: 0 } })
      .sort({ start: -1 })
      .limit(10)
      .toArray(),
  ]);
  const visits = Math.max(0, (done.get(user._id.toHexString()) ?? 0) + (user.loyaltyBonus ?? 0));
  return {
    enabled: rules.enabled,
    cycle: rules.cycle,
    rewards: rules.rewards,
    visits,
    stamps: visits % rules.cycle,
    card: Math.floor(visits / rules.cycle) + 1,
    nextReward: rules.enabled ? nextReward(rules, visits) : null,
    history: used.map((a) => ({
      appointmentId: a._id.toHexString(),
      date: a.start.toISOString(),
      visit: a.loyalty!.visit,
      percent: a.loyalty!.percent,
      discount: a.loyalty!.discount,
    })),
  };
}
