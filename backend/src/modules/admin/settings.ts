import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { audit } from '../../lib/audit';
import { i18nOptionalTextSchema, i18nTextSchema, parseJson } from '../../lib/validation';
import { requireRole } from '../../middleware/auth';
import { DEFAULT_SETTINGS, getSettings, invalidateSettingsCache } from '../settings';

const handle = z
  .string()
  .trim()
  .max(80, 'too_long')
  .transform((v) => v.replace(/^@/, ''));

const optionalUrl = z
  .string()
  .trim()
  .max(500, 'too_long')
  .refine((v) => v === '' || /^https:\/\/[^\s]+$/i.test(v), 'invalid_url');

const settingsSchema = z
  .object({
    name: z.string().trim().min(1, 'required').max(60, 'too_long'),
    legalName: z.string().trim().max(120, 'too_long'),
    legalId: z.string().trim().regex(/^(\d{13})?$/, 'invalid_idno'),
    tagline: i18nTextSchema(80),
    about: i18nOptionalTextSchema(600),
    address: z.string().trim().max(160, 'too_long'),
    city: z.string().trim().max(60, 'too_long'),
    mapsUrl: optionalUrl,
    phone: z.string().trim().max(32, 'too_long'),
    whatsapp: z.string().trim().max(32, 'too_long'),
    viber: z.string().trim().max(32, 'too_long'),
    telegram: handle,
    instagram: handle,
    email: z.union([z.literal(''), z.email({ error: 'invalid_email' })]),
    timezone: z
      .string()
      .trim()
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'invalid_timezone'),
    currency: z.string().trim().regex(/^[A-Z]{3}$/, 'invalid_currency'),
    slotStepMin: z.number().int().refine((v) => [5, 10, 15, 20, 30, 60].includes(v), 'invalid'),
    leadTimeMin: z.number().int().min(0).max(14 * 24 * 60),
    horizonDays: z.number().int().min(1).max(365),
    cancellationWindowHours: z.number().int().min(0).max(14 * 24),
    requireApproval: z.boolean(),
    bufferMin: z.number().int().min(0).max(120),
    maxActiveBookings: z.number().int().min(1).max(20),
    policy: i18nOptionalTextSchema(600),
  })
  .partial();

export function adminSettingsRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => c.json({ settings: await getSettings(deps) }));

  app.patch('/', requireRole('administrator'), async (c) => {
    const input = await parseJson(c, settingsSchema);
    const now = deps.now();
    await deps.col.settings.updateOne(
      { _id: 'studio' },
      {
        $set: { ...input, updatedAt: now },
        $setOnInsert: { ...omit(DEFAULT_SETTINGS, Object.keys(input)) },
        // Saved here = the studio's choice; later default updates leave these fields alone.
        $addToSet: { customized: { $each: Object.keys(input) } },
      },
      { upsert: true },
    );
    invalidateSettingsCache(deps);
    await audit(deps, {
      actorId: c.get('user')._id,
      action: 'settings.update',
      targetType: 'settings',
      targetId: 'studio',
      meta: { fields: Object.keys(input) },
    });
    return c.json({ settings: await getSettings(deps) });
  });

  return app;
}

function omit<T extends object>(obj: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) out[k] = v;
  return out as Partial<T>;
}
