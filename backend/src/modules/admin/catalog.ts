import { Hono, type Context } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import type { CategoryDoc, ServiceDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { slugify } from '../../lib/text';
import { objectIdSchema, paramId, parseJson } from '../../lib/validation';
import {
  MANAGED_CATEGORY_FIELDS,
  MANAGED_SERVICE_FIELDS,
  customizedFields,
  defaultValuesFor,
  rememberRemovedDefault,
} from '../../seed/defaults';
import { categoryInputSchema, categoryPatchSchema, serviceInputSchema, servicePatchSchema } from './schemas';

/** Where an entry came from, for the admin list: "Price list", "Price list, edited" or "Added". */
function origin(doc: { defaultKey?: string; customized?: string[] }) {
  const isDefault = Boolean(doc.defaultKey) && !doc.defaultKey!.startsWith('legacy:');
  return { isDefault, customized: isDefault ? (doc.customized ?? []) : [] };
}

function toCategory(c: CategoryDoc) {
  return {
    id: c._id.toHexString(),
    slug: c.slug,
    name: c.name,
    description: c.description ?? null,
    singleChoice: c.singleChoice ?? false,
    color: c.color,
    order: c.order,
    isActive: c.isActive,
    ...origin(c),
  };
}

function toService(s: ServiceDoc) {
  return {
    id: s._id.toHexString(),
    categoryId: s.categoryId.toHexString(),
    slug: s.slug,
    name: s.name,
    description: s.description,
    durationMin: s.durationMin,
    price: s.price,
    priceFrom: s.priceFrom,
    art: s.art,
    isPopular: s.isPopular,
    isActive: s.isActive,
    order: s.order,
    ...origin(s),
  };
}

/**
 * The price list. Every staff member (admin and administrator) can manage it. Edits to entries
 * that came from the default price list are recorded field by field, so a later default
 * update never overwrites what the studio changed.
 */
export function adminCatalogRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const actor = (c: Context<AppEnv>) => c.get('user')._id;

  app.get('/', async (c) => {
    const [categories, services] = await Promise.all([
      deps.col.categories.find().sort({ order: 1, _id: 1 }).toArray(),
      deps.col.services.find().sort({ order: 1, _id: 1 }).toArray(),
    ]);
    return c.json({ categories: categories.map(toCategory), services: services.map(toService) });
  });

  // ── Categories ─────────────────────────────────────────────────────────────
  app.post('/categories', async (c) => {
    const input = await parseJson(c, categoryInputSchema);
    const now = deps.now();
    const last = await deps.col.categories.find().sort({ order: -1 }).limit(1).next();
    const doc: CategoryDoc = {
      _id: new ObjectId(),
      slug: slugify(input.name.en || input.name.ro),
      ...input,
      order: (last?.order ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await deps.col.categories.insertOne(doc);
    await audit(deps, { actorId: actor(c), action: 'category.create', targetType: 'category', targetId: doc._id });
    return c.json({ category: toCategory(doc) }, 201);
  });

  app.patch('/categories/:id', async (c) => {
    const id = paramId(c);
    const input = await parseJson(c, categoryPatchSchema);
    const updated = await deps.col.categories.findOneAndUpdate(
      { _id: id },
      {
        $set: { ...input, updatedAt: deps.now() },
        $addToSet: { customized: { $each: customizedFields(input, MANAGED_CATEGORY_FIELDS) } },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('Category');
    await audit(deps, { actorId: actor(c), action: 'category.update', targetType: 'category', targetId: id, meta: { fields: Object.keys(input) } });
    return c.json({ category: toCategory(updated) });
  });

  app.post('/categories/:id/reset', async (c) => {
    const id = paramId(c);
    const doc = await deps.col.categories.findOne({ _id: id });
    if (!doc) throw notFound('Category');
    const values = await defaultValuesFor(deps, 'category', doc.defaultKey);
    if (!values) throw new AppError(409, 'NOT_A_DEFAULT', 'This category is not from the default price list');
    const updated = await deps.col.categories.findOneAndUpdate(
      { _id: id },
      { $set: { ...values, customized: [], updatedAt: deps.now() } },
      { returnDocument: 'after' },
    );
    await audit(deps, { actorId: actor(c), action: 'category.reset', targetType: 'category', targetId: id });
    return c.json({ category: toCategory(updated!) });
  });

  app.delete('/categories/:id', async (c) => {
    const id = paramId(c);
    const inUse = await deps.col.services.countDocuments({ categoryId: id });
    if (inUse > 0) throw new AppError(409, 'IN_USE', 'Category still has services');
    const doc = await deps.col.categories.findOneAndDelete({ _id: id });
    if (!doc) throw notFound('Category');
    await rememberRemovedDefault(deps, 'category', doc.defaultKey);
    await audit(deps, { actorId: actor(c), action: 'category.delete', targetType: 'category', targetId: id });
    return c.json({ ok: true });
  });

  // ── Services ───────────────────────────────────────────────────────────────
  const assertCategory = async (categoryId: ObjectId) => {
    const category = await deps.col.categories.findOne({ _id: categoryId });
    if (!category) throw new AppError(422, 'VALIDATION_ERROR', 'Unknown category', { fields: { categoryId: 'invalid' } });
  };

  app.post('/services', async (c) => {
    const input = await parseJson(c, serviceInputSchema);
    await assertCategory(input.categoryId);
    const now = deps.now();
    const last = await deps.col.services.find({ categoryId: input.categoryId }).sort({ order: -1 }).limit(1).next();
    const doc: ServiceDoc = {
      _id: new ObjectId(),
      ...input,
      slug: slugify(input.name.en || input.name.ro),
      order: (last?.order ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await deps.col.services.insertOne(doc);
    await audit(deps, { actorId: actor(c), action: 'service.create', targetType: 'service', targetId: doc._id });
    return c.json({ service: toService(doc) }, 201);
  });

  app.patch('/services/:id', async (c) => {
    const id = paramId(c);
    const input = await parseJson(c, servicePatchSchema);
    if (input.categoryId) await assertCategory(input.categoryId);
    const before = await deps.col.services.findOne({ _id: id }, { projection: { price: 1, durationMin: 1 } });
    const updated = await deps.col.services.findOneAndUpdate(
      { _id: id },
      {
        $set: { ...input, updatedAt: deps.now() },
        $addToSet: { customized: { $each: customizedFields(input, MANAGED_SERVICE_FIELDS) } },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('Service');
    await audit(deps, {
      actorId: actor(c),
      action: 'service.update',
      targetType: 'service',
      targetId: id,
      // Price and duration history, so "who changed the price and from what" is answerable.
      meta: {
        fields: Object.keys(input),
        ...(input.price !== undefined && before ? { price: { from: before.price, to: input.price } } : {}),
        ...(input.durationMin !== undefined && before ? { durationMin: { from: before.durationMin, to: input.durationMin } } : {}),
      },
    });
    return c.json({ service: toService(updated) });
  });

  app.post('/services/:id/reset', async (c) => {
    const id = paramId(c);
    const doc = await deps.col.services.findOne({ _id: id });
    if (!doc) throw notFound('Service');
    const values = await defaultValuesFor(deps, 'service', doc.defaultKey);
    if (!values) throw new AppError(409, 'NOT_A_DEFAULT', 'This service is not from the default price list');
    const updated = await deps.col.services.findOneAndUpdate(
      { _id: id },
      { $set: { ...values, customized: [], updatedAt: deps.now() } },
      { returnDocument: 'after' },
    );
    await audit(deps, { actorId: actor(c), action: 'service.reset', targetType: 'service', targetId: id });
    return c.json({ service: toService(updated!) });
  });

  /** Services referenced by past bookings are archived (hidden), never hard-deleted. */
  app.delete('/services/:id', async (c) => {
    const id = paramId(c);
    const used = await deps.col.appointments.countDocuments({ 'services.serviceId': id }, { limit: 1 });
    if (used > 0) {
      const res = await deps.col.services.updateOne(
        { _id: id },
        { $set: { isActive: false, isPopular: false, updatedAt: deps.now() }, $addToSet: { customized: 'isActive' } },
      );
      if (res.matchedCount === 0) throw notFound('Service');
      await audit(deps, { actorId: actor(c), action: 'service.archive', targetType: 'service', targetId: id });
      return c.json({ ok: true, archived: true });
    }
    const doc = await deps.col.services.findOneAndDelete({ _id: id });
    if (!doc) throw notFound('Service');
    await rememberRemovedDefault(deps, 'service', doc.defaultKey);
    await audit(deps, { actorId: actor(c), action: 'service.delete', targetType: 'service', targetId: id });
    return c.json({ ok: true, archived: false });
  });

  app.post('/reorder', async (c) => {
    const input = await parseJson(
      c,
      z.object({ type: z.enum(['category', 'service']), ids: z.array(objectIdSchema).min(1).max(300) }),
    );
    const now = deps.now();
    const collection = input.type === 'category' ? deps.col.categories : deps.col.services;
    await collection.bulkWrite(
      input.ids.map((id, index) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { order: index + 1, updatedAt: now }, $addToSet: { customized: 'order' } },
        },
      })),
    );
    await audit(deps, { actorId: actor(c), action: `${input.type}.reorder`, targetType: input.type, meta: { count: input.ids.length } });
    return c.json({ ok: true });
  });

  return app;
}
