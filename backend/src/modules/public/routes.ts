import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../../context';
import { getSettings } from '../settings';

/** Unauthenticated, cacheable data the app needs before (or without) signing in. */
export function publicRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/health', async (c) => {
    let db = 'ok';
    try {
      await deps.db.command({ ping: 1 });
    } catch {
      db = 'error';
    }
    return c.json({ status: db === 'ok' ? 'ok' : 'degraded', db, time: deps.now().toISOString() }, db === 'ok' ? 200 : 503);
  });

  app.get('/config', async (c) => {
    const s = await getSettings(deps);
    const bookable = await deps.col.staff.countDocuments({ isActive: true, isBookable: true });
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      auth: { google: Boolean(deps.config.google) },
      studio: {
        name: s.name,
        tagline: s.tagline,
        about: s.about,
        address: s.address,
        city: s.city,
        mapsUrl: s.mapsUrl,
        phone: s.phone,
        whatsapp: s.whatsapp,
        viber: s.viber,
        telegram: s.telegram,
        instagram: s.instagram,
        email: s.email,
        timezone: s.timezone,
        currency: s.currency,
      },
      booking: {
        requireApproval: s.requireApproval,
        cancellationWindowHours: s.cancellationWindowHours,
        leadTimeMin: s.leadTimeMin,
        horizonDays: s.horizonDays,
        maxActiveBookings: s.maxActiveBookings,
        policy: s.policy,
        mastersCount: bookable,
      },
    });
  });

  app.get('/catalog', async (c) => {
    const [categories, services] = await Promise.all([
      deps.col.categories.find({ isActive: true }).sort({ order: 1, _id: 1 }).toArray(),
      deps.col.services.find({ isActive: true }).sort({ order: 1, _id: 1 }).toArray(),
    ]);
    const activeCategoryIds = new Set(categories.map((cat) => cat._id.toHexString()));
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      categories: categories.map((cat) => ({
        id: cat._id.toHexString(),
        slug: cat.slug,
        name: cat.name,
        color: cat.color,
      })),
      services: services
        .filter((s) => activeCategoryIds.has(s.categoryId.toHexString()))
        .map((s) => ({
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
        })),
    });
  });

  app.get('/staff', async (c) => {
    const staff = await deps.col.staff
      .find({ isActive: true, isBookable: true })
      .sort({ order: 1, _id: 1 })
      .toArray();
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      staff: staff.map((s) => ({
        id: s._id.toHexString(),
        name: s.name,
        title: s.title,
        color: s.color,
        serviceIds: s.serviceIds?.map((id) => id.toHexString()) ?? null,
        weekly: s.weekly,
      })),
    });
  });

  return app;
}
