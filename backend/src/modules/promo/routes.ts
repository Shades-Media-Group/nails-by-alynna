import { Hono, type Context } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import type { PromoCodeDoc, UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, isDuplicateKey, notFound } from '../../lib/errors';
import { enforceRateLimits } from '../../lib/rate-limit';
import { todayIn } from '../../lib/time';
import { dateSchema, idListSchema, isoDateTimeSchema, objectIdSchema, paramId, parseJson, parseQuery } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { getSettings } from '../settings';
import { PROMO_CODE, promoStatus, quotePromo } from './service';

const staffChoice = z
  .union([z.literal('any'), objectIdSchema])
  .optional()
  .transform((v) => (v === 'any' || v === undefined ? null : v));

const checkFields = {
  code: z.string().trim().min(1, 'required').max(40, 'too_long'),
  serviceIds: idListSchema(),
  staffId: staffChoice,
  start: isoDateTimeSchema,
};

/**
 * /api/promo — the signed-in client checks a code against the visit on the confirm step (or the
 * code of a booking they are moving, with `exclude`). 200 with what it takes off, or 422
 * PROMO_INVALID with the reason.
 */
export function promoRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/check', async (c) => {
    const user = c.get('user');
    // Codes are short words: trying them one after another is slowed down.
    await enforceRateLimits(deps, [{ key: `promo:check:user:${user._id.toHexString()}`, limit: 30, windowSec: 900 }]);
    const q = parseQuery(c, z.object({ ...checkFields, exclude: objectIdSchema.optional() }));
    const moving = q.exclude ? await deps.col.appointments.findOne({ _id: q.exclude, clientId: user._id }) : null;
    const promo = await quotePromo(
      deps,
      { code: q.code, clientId: user._id, serviceIds: q.serviceIds, staffId: q.staffId, start: new Date(q.start), moving },
      await getSettings(deps),
    );
    return c.json({ promo });
  });

  return app;
}

// ── Staff ─────────────────────────────────────────────────────────────────────

/*
 * Create and edit schemas share the fields; only creation fills defaults (zod applies `.default()`
 * even under `.partial()`, see admin/schemas.ts).
 */
const promoFields = {
  code: z.string().trim().toUpperCase().regex(PROMO_CODE, 'invalid_code'),
  kind: z.enum(['percent', 'amount']),
  value: z.number().int().min(1, 'invalid').max(100_000, 'invalid'),
  startsAt: dateSchema.nullable(),
  endsAt: dateSchema.nullable(),
  maxUses: z.number().int().min(1, 'invalid').max(100_000, 'invalid').nullable(),
  maxUsesPerClient: z.number().int().min(1, 'invalid').max(100, 'invalid'),
  minTotal: z.number().int().min(0, 'invalid').max(100_000, 'invalid'),
  serviceIds: z.array(objectIdSchema).min(1, 'required').max(200, 'too_many').nullable(),
  staffId: objectIdSchema.nullable(),
  firstVisitOnly: z.boolean(),
  isActive: z.boolean(),
  note: z.string().trim().max(300, 'too_long'),
};
const promoInputSchema = z.object({
  ...promoFields,
  startsAt: promoFields.startsAt.default(null),
  endsAt: promoFields.endsAt.default(null),
  maxUses: promoFields.maxUses.default(null),
  maxUsesPerClient: promoFields.maxUsesPerClient.default(1),
  minTotal: promoFields.minTotal.default(0),
  serviceIds: promoFields.serviceIds.default(null),
  staffId: promoFields.staffId.default(null),
  firstVisitOnly: promoFields.firstVisitOnly.default(false),
  isActive: promoFields.isActive.default(true),
  note: promoFields.note.default(''),
});
const promoPatchSchema = z.object(promoFields).partial();

/** Rules across fields, checked on the code as it will be saved. */
function assertCoherent(p: Pick<PromoCodeDoc, 'kind' | 'value' | 'startsAt' | 'endsAt'>) {
  if (p.kind === 'percent' && p.value > 100) {
    throw new AppError(422, 'VALIDATION_ERROR', 'A percentage goes up to 100', { fields: { value: 'max_percent' } });
  }
  if (p.startsAt && p.endsAt && p.endsAt < p.startsAt) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Ends before it starts', { fields: { endsAt: 'end_before_start' } });
  }
}

/**
 * Who changes codes: the owner every code; a master (staff with a master profile) only codes tied
 * to them; other staff look but don't change.
 */
interface PromoAccess {
  manage: 'all' | 'own' | 'none';
  masterId: ObjectId | null;
}

const sameMaster = (a: ObjectId | null, b: ObjectId | null) => (a && b ? a.equals(b) : a === b);

async function accessOf(deps: AppDeps, user: UserDoc): Promise<PromoAccess> {
  const profile = await deps.col.staff.findOne({ userId: user._id, isActive: true }, { projection: { _id: 1 } });
  const masterId = profile?._id ?? null;
  if (user.role === 'administrator') return { manage: 'all', masterId };
  return { manage: masterId ? 'own' : 'none', masterId };
}

function toAdminPromo(p: PromoCodeDoc, today: string, usedByBookings: Set<string>) {
  return {
    id: p._id.toHexString(),
    code: p.code,
    kind: p.kind,
    value: p.value,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    maxUses: p.maxUses,
    maxUsesPerClient: p.maxUsesPerClient,
    minTotal: p.minTotal,
    serviceIds: p.serviceIds?.map((id) => id.toHexString()) ?? null,
    staffId: p.staffId?.toHexString() ?? null,
    firstVisitOnly: p.firstVisitOnly,
    isActive: p.isActive,
    note: p.note,
    /** Bookings holding a use now (upcoming ones, and completed visits it discounted). */
    usedCount: p.redemptions.length,
    status: promoStatus(p, today),
    /** Never on any booking: it can be deleted (a used code is switched off instead). */
    canDelete: p.redemptions.length === 0 && !usedByBookings.has(p._id.toHexString()),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * /api/admin/promo — promo codes. Everyone on the staff sees them (a master only their own) and
 * can check one at the desk; the owner and masters create, edit, switch off and delete unused ones.
 */
export function adminPromoRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const actor = (c: Context<AppEnv>) => c.get('user');

  async function respond(docs: PromoCodeDoc[]) {
    const settings = await getSettings(deps);
    const today = todayIn(settings.timezone, deps.now());
    const used = await deps.col.appointments.distinct('promo.promoId', { 'promo.promoId': { $in: docs.map((d) => d._id) } });
    const usedByBookings = new Set(used.map((id) => String(id)));
    return docs.map((d) => toAdminPromo(d, today, usedByBookings));
  }

  /** The code, when this staff member may change it (404 for a master looking at another's code). */
  async function editable(c: Context<AppEnv>, access: PromoAccess): Promise<PromoCodeDoc> {
    if (access.manage === 'none') throw new AppError(403, 'FORBIDDEN', 'Only the owner and masters manage promo codes');
    const doc = await deps.col.promoCodes.findOne({ _id: paramId(c) });
    if (!doc || (access.manage === 'own' && !doc.staffId?.equals(access.masterId!))) throw notFound('Promo code');
    return doc;
  }

  async function assertStaff(staffId: ObjectId) {
    if (!(await deps.col.staff.countDocuments({ _id: staffId }, { limit: 1 }))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Unknown master', { fields: { staffId: 'invalid' } });
    }
  }

  async function assertServices(serviceIds: ObjectId[] | null) {
    if (serviceIds && (await deps.col.services.countDocuments({ _id: { $in: serviceIds } })) !== new Set(serviceIds.map(String)).size) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Unknown service', { fields: { serviceIds: 'invalid' } });
    }
  }

  app.get('/', async (c) => {
    const access = await accessOf(deps, actor(c));
    const docs = await deps.col.promoCodes
      .find(access.manage === 'own' ? { staffId: access.masterId } : {})
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    return c.json({
      promos: await respond(docs),
      access: { manage: access.manage, masterId: access.masterId?.toHexString() ?? null },
    });
  });

  /** A code checked at the desk for a booking being made (`clientId` absent for a new client). */
  app.get('/check', async (c) => {
    const q = parseQuery(c, z.object({ ...checkFields, clientId: objectIdSchema.optional() }));
    const promo = await quotePromo(
      deps,
      { code: q.code, clientId: q.clientId ?? null, serviceIds: q.serviceIds, staffId: q.staffId, start: new Date(q.start), staff: true },
      await getSettings(deps),
    );
    return c.json({ promo });
  });

  app.post('/', async (c) => {
    const user = actor(c);
    const access = await accessOf(deps, user);
    if (access.manage === 'none') throw new AppError(403, 'FORBIDDEN', 'Only the owner and masters manage promo codes');
    const input = await parseJson(c, promoInputSchema);
    // A master's codes are always tied to them.
    if (access.manage === 'own') {
      if (input.staffId && !input.staffId.equals(access.masterId!)) {
        throw new AppError(403, 'FORBIDDEN', 'Masters create codes for their own bookings only', { fields: { staffId: 'forbidden' } });
      }
      input.staffId = access.masterId;
    } else if (input.staffId) {
      await assertStaff(input.staffId);
    }
    assertCoherent(input);
    await assertServices(input.serviceIds);
    const now = deps.now();
    const doc: PromoCodeDoc = { _id: new ObjectId(), ...input, redemptions: [], createdBy: user._id, createdAt: now, updatedAt: now };
    try {
      await deps.col.promoCodes.insertOne(doc);
    } catch (error) {
      if (isDuplicateKey(error)) throw new AppError(409, 'CONFLICT', 'This code already exists', { fields: { code: 'taken' } });
      throw error;
    }
    await audit(deps, { actorId: user._id, action: 'promo.create', targetType: 'promo', targetId: doc._id, meta: { code: doc.code } });
    const [promo] = await respond([doc]);
    return c.json({ promo }, 201);
  });

  app.patch('/:id', async (c) => {
    const user = actor(c);
    const access = await accessOf(deps, user);
    const doc = await editable(c, access);
    const input = await parseJson(c, promoPatchSchema);
    if (input.staffId !== undefined && !sameMaster(input.staffId, doc.staffId)) {
      if (access.manage === 'own') throw new AppError(403, 'FORBIDDEN', 'A master cannot move a code to someone else', { fields: { staffId: 'forbidden' } });
      if (input.staffId) await assertStaff(input.staffId);
    }
    // Bookings show the code they were made with: once used, its text stays (make a new code instead).
    if (input.code !== undefined && input.code !== doc.code) {
      const used = doc.redemptions.length > 0 || (await deps.col.appointments.countDocuments({ 'promo.promoId': doc._id }, { limit: 1 })) > 0;
      if (used) throw new AppError(409, 'IN_USE', 'A used code keeps its text', { fields: { code: 'locked' } });
    }
    assertCoherent({ ...doc, ...input });
    if (input.serviceIds !== undefined) await assertServices(input.serviceIds);
    let updated: PromoCodeDoc | null;
    try {
      updated = await deps.col.promoCodes.findOneAndUpdate(
        { _id: doc._id },
        { $set: { ...input, updatedAt: deps.now() } },
        { returnDocument: 'after' },
      );
    } catch (error) {
      if (isDuplicateKey(error)) throw new AppError(409, 'CONFLICT', 'This code already exists', { fields: { code: 'taken' } });
      throw error;
    }
    if (!updated) throw notFound('Promo code');
    const switched = input.isActive !== undefined && input.isActive !== doc.isActive;
    await audit(deps, {
      actorId: user._id,
      action: switched ? (input.isActive ? 'promo.activate' : 'promo.deactivate') : 'promo.update',
      targetType: 'promo',
      targetId: doc._id,
      meta: { code: updated.code },
    });
    const [promo] = await respond([updated]);
    return c.json({ promo });
  });

  /** Only a code no booking ever used; a used code is switched off instead, so bookings keep its history. */
  app.delete('/:id', async (c) => {
    const user = actor(c);
    const doc = await editable(c, await accessOf(deps, user));
    if ((await deps.col.appointments.countDocuments({ 'promo.promoId': doc._id }, { limit: 1 })) > 0) {
      throw new AppError(409, 'IN_USE', 'This code was used by bookings; switch it off instead');
    }
    // No use taken meanwhile (a booking being made right now holds one before it is saved).
    const removed = await deps.col.promoCodes.findOneAndDelete({ _id: doc._id, redemptions: { $size: 0 } });
    if (!removed) throw new AppError(409, 'IN_USE', 'This code was just used; switch it off instead');
    await audit(deps, { actorId: user._id, action: 'promo.delete', targetType: 'promo', targetId: doc._id, meta: { code: doc.code } });
    return c.json({ ok: true });
  });

  return app;
}
