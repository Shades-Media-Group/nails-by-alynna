import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import type { CategoryDoc, ServiceDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { slugify } from '../../lib/text';
import { objectIdSchema, paramId, parseJson } from '../../lib/validation';
import { requireRole } from '../../middleware/auth';
import { categoryInputSchema, serviceInputSchema } from './schemas';

function toCategory(c: CategoryDoc) {
  return {
    id: c._id.toHexString(),
    slug: c.slug,
    name: c.name,
    color: c.color,
    order: c.order,
    isActive: c.isActive,
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
  };
}

/** Catalog is readable by all staff; changes are the administrator's. */
export function adminCatalogRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const owner = requireRole('administrator');

  app.get('/', async (c) => {
    const [categories, services] = await Promise.all([
      deps.col.categories.find().sort({ order: 1, _id: 1 }).toArray(),
      deps.col.services.find().sort({ order: 1, _id: 1 }).toArray(),
    ]);
    return c.json({ categories: categories.map(toCategory), services: services.map(toService) });
  });

  app.post('/categories', owner, async (c) => {
    const input = await parseJson(c, categoryInputSchema);
    const now = deps.now();
    const last = await deps.col.categories.find().sort({ order: -1 }).limit(1).next();
    const doc: CategoryDoc = {
      _id: new ObjectId(),
      slug: slugify(input.name.en || input.name.ro),
      name: input.name,
      color: input.color,
      order: (last?.order ?? 0) + 1,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    };
    await deps.col.categories.insertOne(doc);
    await audit(deps, { actorId: c.get('user')._id, action: 'category.create', targetType: 'category', targetId: doc._id });
    return c.json({ category: toCategory(doc) }, 201);
  });

  app.patch('/categories/:id', owner, async (c) => {
    const id = paramId(c);
    const input = await parseJson(c, categoryInputSchema.partial());
    const updated = await deps.col.categories.findOneAndUpdate(
      { _id: id },
      { $set: { ...input, updatedAt: deps.now() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('Category');
    await audit(deps, { actorId: c.get('user')._id, action: 'category.update', targetType: 'category', targetId: id });
    return c.json({ category: toCategory(updated) });
  });

  app.delete('/categories/:id', owner, async (c) => {
    const id = paramId(c);
    const inUse = await deps.col.services.countDocuments({ categoryId: id });
    if (inUse > 0) throw new AppError(409, 'IN_USE', 'Category still has services');
    const res = await deps.col.categories.deleteOne({ _id: id });
    if (res.deletedCount === 0) throw notFound('Category');
    await audit(deps, { actorId: c.get('user')._id, action: 'category.delete', targetType: 'category', targetId: id });
    return c.json({ ok: true });
  });

  app.post('/services', owner, async (c) => {
    const input = await parseJson(c, serviceInputSchema);
    const category = await deps.col.categories.findOne({ _id: input.categoryId });
    if (!category) throw new AppError(422, 'VALIDATION_ERROR', 'Unknown category', { fields: { categoryId: 'invalid' } });
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
    await audit(deps, { actorId: c.get('user')._id, action: 'service.create', targetType: 'service', targetId: doc._id });
    return c.json({ service: toService(doc) }, 201);
  });

  app.patch('/services/:id', owner, async (c) => {
    const id = paramId(c);
    const input = await parseJson(c, serviceInputSchema.partial());
    if (input.categoryId) {
      const category = await deps.col.categories.findOne({ _id: input.categoryId });
      if (!category) throw new AppError(422, 'VALIDATION_ERROR', 'Unknown category', { fields: { categoryId: 'invalid' } });
    }
    const updated = await deps.col.services.findOneAndUpdate(
      { _id: id },
      { $set: { ...input, updatedAt: deps.now() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('Service');
    await audit(deps, { actorId: c.get('user')._id, action: 'service.update', targetType: 'service', targetId: id });
    return c.json({ service: toService(updated) });
  });

  /** Services referenced by past bookings are archived (hidden), never hard-deleted. */
  app.delete('/services/:id', owner, async (c) => {
    const id = paramId(c);
    const used = await deps.col.appointments.countDocuments({ 'services.serviceId': id }, { limit: 1 });
    if (used > 0) {
      const res = await deps.col.services.updateOne({ _id: id }, { $set: { isActive: false, updatedAt: deps.now() } });
      if (res.matchedCount === 0) throw notFound('Service');
      await audit(deps, { actorId: c.get('user')._id, action: 'service.archive', targetType: 'service', targetId: id });
      return c.json({ ok: true, archived: true });
    }
    const res = await deps.col.services.deleteOne({ _id: id });
    if (res.deletedCount === 0) throw notFound('Service');
    await audit(deps, { actorId: c.get('user')._id, action: 'service.delete', targetType: 'service', targetId: id });
    return c.json({ ok: true, archived: false });
  });

  app.post('/reorder', owner, async (c) => {
    const input = await parseJson(
      c,
      z.object({ type: z.enum(['category', 'service']), ids: z.array(objectIdSchema).min(1).max(300) }),
    );
    const now = deps.now();
    const collection = input.type === 'category' ? deps.col.categories : deps.col.services;
    await collection.bulkWrite(
      input.ids.map((id, index) => ({
        updateOne: { filter: { _id: id }, update: { $set: { order: index + 1, updatedAt: now } } },
      })),
    );
    return c.json({ ok: true });
  });

  return app;
}
