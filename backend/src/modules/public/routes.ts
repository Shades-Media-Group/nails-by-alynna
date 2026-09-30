import { Hono } from 'hono';
import { BUILD, STARTED_AT } from '../../build-info';
import type { AppDeps, AppEnv } from '../../context';
import { schemaStatus, type SchemaStatus } from '../../db';
import { addDays, minutesToTime, timeToMinutes, todayIn } from '../../lib/time';
import { opensDays, sessionMinOf } from '../availability/service';
import { getSettings } from '../settings';

/** Days ahead the opening hours show for masters who open their days one by one. */
const OPEN_DAYS_AHEAD = 14;

/** Unauthenticated, cacheable data the app needs before (or without) signing in. */
export function publicRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  /**
   * Uptime monitoring (UptimeRobot & co.): 200 + "status":"ok" when the API and database
   * answer, 503 otherwise. Also reports which build is live and what changed in it.
   */
  app.get('/health', async (c) => {
    const started = performance.now();
    let database: 'ok' | 'error' = 'ok';
    let schema: SchemaStatus | null = null;
    try {
      await deps.db.ping();
    } catch {
      database = 'error';
    }
    const latencyMs = Math.round(performance.now() - started);
    // Whether the tables and indexes of this build exist yet (migrated in the background after
    // a start); reported beside the database, not counted against it, so a restart doesn't
    // look like an outage to uptime monitors.
    if (database === 'ok') schema = await schemaStatus(deps.db).catch(() => null);
    const ok = database === 'ok';
    return c.json(
      {
        status: ok ? 'ok' : 'down',
        service: 'nails-by-alynna-api',
        version: BUILD.version,
        commit: BUILD.commit,
        builtAt: BUILD.builtAt,
        runtime: 'node',
        environment: deps.config.env,
        uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
        checks: { database: { status: database, latencyMs, schema } },
        changes: BUILD.changes,
        time: new Date().toISOString(),
      },
      ok ? 200 : 503,
    );
  });

  app.get('/config', async (c) => {
    const s = await getSettings(deps);
    const [bookable, demoRoles] = await Promise.all([
      deps.col.staff.countDocuments({ isActive: true, isBookable: true }),
      deps.config.demoRoles.length > 0
        ? deps.col.users.distinct('role', { isDemo: true, isActive: true, deletedAt: null, role: { $in: deps.config.demoRoles } })
        : [],
    ]);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      auth: { google: Boolean(deps.config.google), demo: demoRoles },
      studio: {
        name: s.name,
        tagline: s.tagline,
        about: s.about,
        address: s.address,
        city: s.city,
        mapsUrl: s.mapsUrl,
        location: s.location,
        phone: s.phone,
        whatsapp: s.whatsapp,
        viber: s.viber,
        telegram: s.telegram,
        instagram: s.instagram,
        legalName: s.legalName,
        legalId: s.legalId,
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
      loyalty: { enabled: s.loyaltyEnabled, cycle: s.loyaltyCycle, rewards: s.loyaltyRewards },
      // Whether clients have "Reminders to come back" to switch in Profile → Notifications.
      rebook: { enabled: s.rebook.enabled },
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
        description: cat.description ?? null,
        singleChoice: cat.singleChoice ?? false,
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
          details: s.details ?? { ro: '', ru: '', en: '' },
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
    // Masters in working-days mode: the days they opened in the next two weeks, for the opening hours.
    const byDays = staff.filter(opensDays);
    const today = todayIn((await getSettings(deps)).timezone, deps.now());
    const openDays = byDays.length
      ? await deps.col.workDays
          .find(
            { staffId: { $in: byDays.map((s) => s._id) }, date: { $gte: today, $lte: addDays(today, OPEN_DAYS_AHEAD - 1) } },
            { projection: { staffId: 1, date: 1, times: 1 } },
          )
          .sort({ date: 1 })
          .toArray()
      : [];
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      staff: staff.map((s) => ({
        id: s._id.toHexString(),
        name: s.name,
        title: s.title,
        color: s.color,
        serviceIds: s.serviceIds?.map((id) => id.toHexString()) ?? null,
        weekly: s.weekly,
        bufferMin: s.bufferMin ?? 0,
        scheduleMode: s.scheduleMode ?? 'weekly',
        /** Working-days mode only: the days open in the next two weeks (`weekly` doesn't apply). */
        days: opensDays(s)
          ? openDays
              .filter((d) => d.staffId.equals(s._id) && d.times.length > 0)
              .map((d) => ({
                date: d.date,
                start: d.times[0]!,
                end: minutesToTime(Math.min(24 * 60, timeToMinutes(d.times.at(-1)!) + sessionMinOf(s))),
              }))
          : [],
      })),
    });
  });

  return app;
}
