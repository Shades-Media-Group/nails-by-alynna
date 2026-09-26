import type { ObjectId } from 'mongodb';
import type { AppDeps } from '../../context';
import {
  ACTIVE_STATUSES,
  type AppointmentDoc,
  type AppointmentLoyalty,
  type AppointmentPromo,
  type AppointmentStatus,
  type PromoCodeDoc,
  type PromoKind,
  type PromoProblem,
  type StudioSettings,
} from '../../db/types';
import { AppError } from '../../lib/errors';
import { toZonedParts } from '../../lib/time';
import { loadAvailabilityContext, loadServices, slotsForDate } from '../availability/service';

/*
 * Promo codes: a percentage or an amount off a visit, typed by the client when booking (or by
 * staff at the desk). A code is checked in this order, so the reasons nobody can fix come first:
 *
 * - It must be switched on, and the visit must fall on its dates (visit days, studio time).
 * - Uses are counted per booking that holds one. A use is taken when the booking is made and given
 *   back when it is cancelled or missed; taking one is a single conditional update, so two clients
 *   can never both get the last use (and one client never goes past their own limit).
 * - "First visit" means no completed visit, no stamps added by hand and no earlier upcoming booking.
 * - A code tied to a master works only on that master's bookings. A code for some services
 *   discounts only those services and needs at least one of them; a minimum is checked against
 *   the visit's list total.
 *
 * Discounts never add up (as with a single code per booking on Fresha and Booksy): a visit gets its
 * promo code or its loyalty discount, whichever is bigger, and a tie goes to the loyalty card so the
 * client keeps the code. The choice is locked in when the visit is completed; a code that lost
 * gives its use back.
 */

export const PROMO_CODE = /^[A-Z0-9]{3,20}$/;

/** A code as typed (any case, with spaces or dashes) in its stored form; null when it can't be one. */
export function normalizePromoCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]+/g, '');
  return PROMO_CODE.test(code) ? code : null;
}

export async function findPromo(deps: AppDeps, input: string): Promise<PromoCodeDoc | null> {
  const code = normalizePromoCode(input);
  return code ? deps.col.promoCodes.findOne({ code }) : null;
}

// ── Maths ────────────────────────────────────────────────────────────────────

export interface PromoLine {
  serviceId: ObjectId;
  price: number;
}

/**
 * What a code takes off a visit: a percentage (rounded to whole units, like loyalty discounts) or
 * an amount, only on the services it covers, and never more than they cost.
 */
export function promoDiscount(
  promo: Pick<PromoCodeDoc, 'kind' | 'value' | 'serviceIds'>,
  lines: PromoLine[],
): { discount: number; covered: ObjectId[]; coveredTotal: number } {
  const allowed = promo.serviceIds ? new Set(promo.serviceIds.map((id) => id.toHexString())) : null;
  const covered = lines.filter((line) => !allowed || allowed.has(line.serviceId.toHexString()));
  const coveredTotal = covered.reduce((sum, line) => sum + line.price, 0);
  const raw = promo.kind === 'percent' ? Math.round((coveredTotal * promo.value) / 100) : promo.value;
  return { discount: Math.max(0, Math.min(raw, coveredTotal)), covered: covered.map((line) => line.serviceId), coveredTotal };
}

/** The discount a visit's loyalty stamp carries (0 when it has none). */
const loyaltyAmount = (loyalty: Pick<AppointmentLoyalty, 'percent' | 'discount'> | null | undefined) =>
  loyalty && loyalty.percent > 0 ? loyalty.discount : 0;

/** Promo code or loyalty discount, never both: the code wins only when it gives more. */
export function promoBeatsLoyalty(
  promo: Pick<AppointmentPromo, 'discount'>,
  loyalty: Pick<AppointmentLoyalty, 'percent' | 'discount'> | null | undefined,
): boolean {
  return promo.discount > loyaltyAmount(loyalty);
}

// ── Checks ───────────────────────────────────────────────────────────────────

/** The booking a code is checked against. */
export interface PromoTarget {
  /** null: a client the studio is adding right now (no visits, no uses yet). */
  clientId: ObjectId | null;
  lines: PromoLine[];
  start: Date;
  /** Masters who may take the visit (one, once it is booked); null when that can't be known yet. */
  staffIds: ObjectId[] | null;
  /** A booking checked again (moved or restored): its own use and place don't count against it. */
  appointmentId?: ObjectId;
}

export function targetOf(a: Pick<AppointmentDoc, '_id' | 'clientId' | 'staffId' | 'services' | 'start'>): PromoTarget {
  return {
    clientId: a.clientId,
    lines: a.services.map((s) => ({ serviceId: s.serviceId, price: s.price })),
    start: a.start,
    staffIds: [a.staffId],
    appointmentId: a._id,
  };
}

/** No completed visit, no stamps added by hand, and no other upcoming booking before this one. */
async function isFirstVisit(deps: AppDeps, target: PromoTarget): Promise<boolean> {
  if (!target.clientId) return true;
  const [client, earlier] = await Promise.all([
    deps.col.users.findOne({ _id: target.clientId }, { projection: { loyaltyBonus: 1 } }),
    deps.col.appointments.countDocuments(
      {
        clientId: target.clientId,
        ...(target.appointmentId ? { _id: { $ne: target.appointmentId } } : {}),
        $or: [{ status: 'completed' }, { status: { $in: ACTIVE_STATUSES }, start: { $lt: target.start } }],
      },
      { limit: 1 },
    ),
  ]);
  return earlier === 0 && (client?.loyaltyBonus ?? 0) <= 0;
}

/**
 * The first reason `promo` can't discount `target`, or null when it can. `move` checks only what a
 * new time or master changes (the dates and the master): a moved booking already holds its use.
 */
export async function promoProblem(
  deps: AppDeps,
  promo: PromoCodeDoc,
  target: PromoTarget,
  settings: StudioSettings,
  scope: 'full' | 'move' = 'full',
): Promise<PromoProblem | null> {
  const full = scope === 'full';
  const day = toZonedParts(target.start, settings.timezone).date;
  if (full && !promo.isActive) return 'inactive';
  if (promo.endsAt && day > promo.endsAt) return 'expired';
  if (full) {
    const others = promo.redemptions.filter((r) => !target.appointmentId || !r.appointmentId.equals(target.appointmentId));
    if (promo.maxUses !== null && others.length >= promo.maxUses) return 'used_up';
    const mine = target.clientId ? others.filter((r) => r.clientId.equals(target.clientId!)).length : 0;
    if (mine >= promo.maxUsesPerClient) return 'used_by_you';
    if (promo.firstVisitOnly && !(await isFirstVisit(deps, target))) return 'first_visit';
  }
  if (promo.startsAt && day < promo.startsAt) return 'not_started';
  if (promo.staffId && target.staffIds && !target.staffIds.some((id) => id.equals(promo.staffId!))) return 'master';
  if (full) {
    if (promoDiscount(promo, target.lines).covered.length === 0) return 'services';
    if (target.lines.reduce((sum, line) => sum + line.price, 0) < promo.minTotal) return 'min_total';
  }
  return null;
}

/**
 * 422 PROMO_INVALID: `fields.promoCode` says why; the other fields carry what the message needs
 * (the last or first day, the minimum, the master's name).
 */
export function promoError(problem: PromoProblem, promo?: PromoCodeDoc | null, masterName?: string | null): AppError {
  const fields: Record<string, string> = { promoCode: problem };
  if (problem === 'expired' && promo?.endsAt) fields.endsAt = promo.endsAt;
  if (problem === 'not_started' && promo?.startsAt) fields.startsAt = promo.startsAt;
  if (problem === 'min_total' && promo) fields.minTotal = String(promo.minTotal);
  if (problem === 'master' && masterName) fields.master = masterName;
  return new AppError(422, 'PROMO_INVALID', `Promo code does not apply: ${problem}`, { fields });
}

async function rejection(deps: AppDeps, problem: PromoProblem, promo: PromoCodeDoc | null): Promise<AppError> {
  const master =
    problem === 'master' && promo?.staffId ? await deps.col.staff.findOne({ _id: promo.staffId }, { projection: { name: 1 } }) : null;
  return promoError(problem, promo, master?.name);
}

// ── Uses ─────────────────────────────────────────────────────────────────────

/**
 * Takes one use of a code for a booking, in one conditional update: only while the code is on
 * and has a use left overall and for this client. False when there is none left.
 */
export async function takePromoUse(
  deps: AppDeps,
  promoId: ObjectId,
  use: { appointmentId: ObjectId; clientId: ObjectId },
): Promise<boolean> {
  const res = await deps.col.promoCodes.updateOne(
    {
      _id: promoId,
      isActive: true,
      'redemptions.appointmentId': { $ne: use.appointmentId },
      $expr: {
        $and: [
          { $or: [{ $eq: [{ $ifNull: ['$maxUses', null] }, null] }, { $lt: [{ $size: '$redemptions' }, '$maxUses'] }] },
          {
            $lt: [
              { $size: { $filter: { input: '$redemptions', cond: { $eq: ['$$this.clientId', use.clientId] } } } },
              '$maxUsesPerClient',
            ],
          },
        ],
      },
    },
    { $push: { redemptions: { ...use, at: deps.now() } } },
  );
  if (res.modifiedCount === 1) return true;
  // Already held by this booking (a request sent twice): that is its use.
  return (await deps.col.promoCodes.countDocuments({ _id: promoId, 'redemptions.appointmentId': use.appointmentId }, { limit: 1 })) > 0;
}

/** Gives a booking's use back to the code (nothing happens when it held none). */
export async function givePromoUseBack(deps: AppDeps, promoId: ObjectId, appointmentId: ObjectId): Promise<void> {
  await deps.col.promoCodes.updateOne({ _id: promoId }, { $pull: { redemptions: { appointmentId } } });
}

/** Why a use could not be taken: the code changed or ran out meanwhile. */
async function whyNoUse(deps: AppDeps, promoId: ObjectId): Promise<PromoProblem> {
  const fresh = await deps.col.promoCodes.findOne({ _id: promoId }, { projection: { isActive: 1, maxUses: 1, redemptions: 1 } });
  if (!fresh) return 'unknown';
  if (!fresh.isActive) return 'inactive';
  if (fresh.maxUses !== null && fresh.redemptions.length >= fresh.maxUses) return 'used_up';
  return 'used_by_you';
}

function frozen(promo: PromoCodeDoc, lines: PromoLine[]): AppointmentPromo {
  return { promoId: promo._id, code: promo.code, kind: promo.kind, value: promo.value, discount: promoDiscount(promo, lines).discount };
}

// ── Bookings ─────────────────────────────────────────────────────────────────

/**
 * Checks `promo` for a booking about to be written (its master, services and time are final) and
 * holds one use for it under the booking's id, before the booking exists. Throws PROMO_INVALID.
 */
export async function claimPromo(
  deps: AppDeps,
  promo: PromoCodeDoc,
  booking: Pick<AppointmentDoc, '_id' | 'clientId' | 'staffId' | 'services' | 'start'>,
  settings: StudioSettings,
): Promise<AppointmentPromo> {
  const target = targetOf(booking);
  const problem = await promoProblem(deps, promo, target, settings);
  if (problem) throw await rejection(deps, problem, promo);
  if (!(await takePromoUse(deps, promo._id, { appointmentId: booking._id, clientId: booking.clientId }))) {
    throw await rejection(deps, await whyNoUse(deps, promo._id), promo);
  }
  return frozen(promo, target.lines);
}

/**
 * After a booking moved: its code stays while it covers the new day and master. Otherwise it
 * comes off the booking with a note saying why, and its use goes back to the code.
 */
export async function recheckPromoAfterMove(deps: AppDeps, appointment: AppointmentDoc, settings: StudioSettings): Promise<AppointmentDoc> {
  if (!appointment.promo) return appointment;
  const promo = await deps.col.promoCodes.findOne({ _id: appointment.promo.promoId });
  const problem = promo ? await promoProblem(deps, promo, targetOf(appointment), settings, 'move') : 'unknown';
  if (!problem) return appointment;
  const promoRemoved = { code: appointment.promo.code, reason: problem, at: deps.now() };
  await deps.col.appointments.updateOne({ _id: appointment._id }, { $set: { promo: null, promoRemoved } });
  await givePromoUseBack(deps, appointment.promo.promoId, appointment._id);
  return { ...appointment, promo: null, promoRemoved };
}

/** Whether a booking holds a use of its code: while it is to come, and once completed with it. */
export function holdsPromoUse(status: AppointmentStatus, promo: AppointmentPromo | null | undefined): boolean {
  if (!promo) return false;
  return ACTIVE_STATUSES.includes(status) || (status === 'completed' && promo.applied !== false);
}

export interface PromoStatusChange {
  /** Saved together with the new status. */
  set: Pick<Partial<AppointmentDoc>, 'promo' | 'promoRemoved'>;
  /** After the booking is saved: gives back a use it no longer holds. */
  saved: () => Promise<void>;
  /** When saving failed: gives back a use taken for it. */
  failed: () => Promise<void>;
}

/**
 * What a status change does to the booking's code. Cancelled or missed: the use goes back.
 * Restored or reopened: the use is taken again if the code still applies, otherwise the code comes
 * off with a note. Completed: the visit keeps the bigger of the code and its loyalty discount.
 */
export async function promoOnStatusChange(
  deps: AppDeps,
  doc: AppointmentDoc,
  next: AppointmentStatus,
  loyalty: Pick<AppointmentLoyalty, 'percent' | 'discount'> | null | undefined,
  settings: StudioSettings,
): Promise<PromoStatusChange> {
  const nothing = async () => {};
  const current = doc.promo;
  if (!current) return { set: {}, saved: nothing, failed: nothing };
  const { promoId, code, kind, value, discount } = current;
  const promo: AppointmentPromo =
    next === 'completed'
      ? { promoId, code, kind, value, discount, applied: promoBeatsLoyalty(current, loyalty) }
      : { promoId, code, kind, value, discount };
  const had = holdsPromoUse(doc.status, current);
  const has = holdsPromoUse(next, promo);
  const giveBack = () => givePromoUseBack(deps, promoId, doc._id);
  if (had && !has) return { set: { promo }, saved: giveBack, failed: nothing };
  if (!had && has) {
    const live = await deps.col.promoCodes.findOne({ _id: promoId });
    let problem = live ? await promoProblem(deps, live, targetOf(doc), settings) : 'unknown';
    if (!problem && !(await takePromoUse(deps, promoId, { appointmentId: doc._id, clientId: doc.clientId }))) {
      problem = await whyNoUse(deps, promoId);
    }
    if (problem) {
      return { set: { promo: null, promoRemoved: { code, reason: problem, at: deps.now() } }, saved: nothing, failed: nothing };
    }
    return { set: { promo }, saved: nothing, failed: giveBack };
  }
  return { set: { promo }, saved: nothing, failed: nothing };
}

// ── What the apps show ───────────────────────────────────────────────────────

/**
 * The code on a booking, and whether its discount is the one the visit gets: decided at completion,
 * expected before (against the loyalty discount the visit is expected to earn), none once
 * cancelled or missed.
 */
export function promoView(a: AppointmentDoc, loyalty: Pick<AppointmentLoyalty, 'percent' | 'discount'> | null | undefined) {
  if (!a.promo) return null;
  const applied =
    a.status === 'completed' ? a.promo.applied !== false : ACTIVE_STATUSES.includes(a.status) && promoBeatsLoyalty(a.promo, loyalty);
  return { code: a.promo.code, kind: a.promo.kind, value: a.promo.value, discount: a.promo.discount, applied };
}

export function removedPromoView(a: AppointmentDoc) {
  return a.promoRemoved ? { code: a.promoRemoved.code, reason: a.promoRemoved.reason, at: a.promoRemoved.at.toISOString() } : null;
}

export type PromoStatus = 'active' | 'scheduled' | 'expired' | 'used_up' | 'off';

/** Where a code stands today (studio time), for the staff list. */
export function promoStatus(p: PromoCodeDoc, today: string): PromoStatus {
  if (!p.isActive) return 'off';
  if (p.endsAt && p.endsAt < today) return 'expired';
  if (p.maxUses !== null && p.redemptions.length >= p.maxUses) return 'used_up';
  if (p.startsAt && p.startsAt > today) return 'scheduled';
  return 'active';
}

/** A code checked against a visit before it is booked or moved: what it takes off. */
export interface PromoQuote {
  code: string;
  kind: PromoKind;
  value: number;
  /** Off this visit, in the studio currency. */
  discount: number;
  /** The visit's list total, and the part of it the code covers. */
  total: number;
  coveredTotal: number;
  /** The booked services it discounts; null = all of them. */
  serviceIds: string[] | null;
  /** The master it belongs to; null = the whole studio. */
  staffId: string | null;
}

/**
 * Checks a typed code against a visit: the services, the master (or, for "any master", the masters
 * free at that time) and the day. `moving`: a booking of this client being moved, whose own code is
 * checked the way a move checks it. Throws PROMO_INVALID with the reason.
 */
export async function quotePromo(
  deps: AppDeps,
  input: {
    code: string;
    clientId: ObjectId | null;
    serviceIds: ObjectId[];
    staffId: ObjectId | null;
    start: Date;
    moving?: AppointmentDoc | null;
    /** Staff at the desk see every free time; clients the published ones. */
    staff?: boolean;
  },
  settings: StudioSettings,
): Promise<PromoQuote> {
  const promo = await findPromo(deps, input.code);
  if (!promo) throw promoError('unknown');
  const moving = input.moving?.promo?.promoId.equals(promo._id) ? input.moving : null;
  const lines = moving
    ? targetOf(moving).lines
    : (await loadServices(deps, input.serviceIds)).map((s) => ({ serviceId: s._id, price: s.price }));

  let staffIds: ObjectId[] | null = input.staffId ? [input.staffId] : null;
  if (!staffIds && promo.staffId) {
    // "Any master": the booking goes to a master free at that time, the code's own when it can.
    const date = toZonedParts(input.start, settings.timezone).date;
    const ctx = await loadAvailabilityContext(deps, {
      serviceIds: input.serviceIds,
      staffId: null,
      from: date,
      to: date,
      excludeAppointmentId: input.moving?._id,
    });
    const slot = slotsForDate(ctx, date, deps.now(), { staff: input.staff }).find((s) => s.start === input.start.toISOString());
    staffIds = slot ? ctx.staff.filter((s) => slot.staffIds.includes(s._id.toHexString())).map((s) => s._id) : null;
  }

  const target: PromoTarget = { clientId: input.clientId, lines, start: input.start, staffIds, appointmentId: input.moving?._id };
  const problem = await promoProblem(deps, promo, target, settings, moving ? 'move' : 'full');
  if (problem) throw await rejection(deps, problem, promo);

  const maths = promoDiscount(promo, lines);
  const total = lines.reduce((sum, line) => sum + line.price, 0);
  return {
    code: promo.code,
    kind: promo.kind,
    value: promo.value,
    discount: moving?.promo ? moving.promo.discount : maths.discount,
    total,
    coveredTotal: maths.coveredTotal,
    serviceIds: maths.covered.length === lines.length ? null : maths.covered.map((id) => id.toHexString()),
    staffId: promo.staffId?.toHexString() ?? null,
  };
}
