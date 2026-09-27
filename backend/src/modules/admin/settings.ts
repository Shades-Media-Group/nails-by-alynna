import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { REBOOK_TONES, type RebookSettings, type StudioSettings } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { enforceRateLimits } from '../../lib/rate-limit';
import { MARKUP, i18nOptionalTextSchema, i18nTextSchema, parseJson } from '../../lib/validation';
import { requireRole } from '../../middleware/auth';
import { knownPlaceholders, rebookPreview, sendRebookTest } from '../notifications/rebook';
import { DEFAULT_SETTINGS, REBOOK_LIMITS, getSettings, invalidateSettingsCache } from '../settings';

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

/** One line of a reminder's text: plain text on one line, with only the known placeholders. */
const rebookLine = (max: number) =>
  z
    .string()
    .overwrite((v) => v.replace(/\s+/g, ' ').trim())
    .max(max, 'too_long')
    .refine((v) => !MARKUP.test(v), 'plain_text')
    .refine(knownPlaceholders, 'unknown_placeholder');
const rebookI18n = (max: number) => z.object({ ro: rebookLine(max), ru: rebookLine(max), en: rebookLine(max) }).partial();
const rebookTextSchema = z.object({ title: rebookI18n(80), body: rebookI18n(300) }).partial();
const between = (range: { min: number; max: number }) => z.number().int().min(range.min, 'out_of_range').max(range.max, 'out_of_range');

/** Any part of the come-back reminders; what is left out keeps its saved value. */
const rebookSchema = z
  .object({
    enabled: z.boolean(),
    firstAfterDays: between(REBOOK_LIMITS.firstAfterDays),
    repeatEveryDays: between(REBOOK_LIMITS.repeatEveryDays),
    maxReminders: between(REBOOK_LIMITS.maxReminders),
    channels: z.object({ email: z.boolean(), push: z.boolean() }).partial(),
    texts: z.object({ first: rebookTextSchema, nudge: rebookTextSchema, last: rebookTextSchema }).partial(),
  })
  .partial();

function mergeRebook(current: RebookSettings, patch: z.infer<typeof rebookSchema>): RebookSettings {
  const texts = { ...current.texts };
  for (const tone of REBOOK_TONES) {
    const text = patch.texts?.[tone];
    if (text) texts[tone] = { title: { ...texts[tone].title, ...text.title }, body: { ...texts[tone].body, ...text.body } };
  }
  return {
    enabled: patch.enabled ?? current.enabled,
    firstAfterDays: patch.firstAfterDays ?? current.firstAfterDays,
    repeatEveryDays: patch.repeatEveryDays ?? current.repeatEveryDays,
    maxReminders: patch.maxReminders ?? current.maxReminders,
    channels: { ...current.channels, ...patch.channels },
    texts,
  };
}

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
    smartSlots: z.boolean(),
    maxGapMin: z.number().int().min(0).max(60),
    minBookableGapMin: z.number().int().min(0).max(8 * 60),
    maxActiveBookings: z.number().int().min(1).max(20),
    policy: i18nOptionalTextSchema(600),
    loyaltyEnabled: z.boolean(),
    loyaltyCycle: z.number().int().min(2).max(20),
    loyaltyRewards: z
      .array(z.object({ visit: z.number().int().min(1).max(20), percent: z.number().int().min(1).max(100) }))
      .max(6),
    rebook: rebookSchema,
  })
  .partial();

export function adminSettingsRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => c.json({ settings: await getSettings(deps) }));

  /** Come-back reminders: the built-in texts and example values to preview them with. */
  app.get('/rebook', async (c) => c.json(await rebookPreview(deps)));

  /** "Send me a test": the first come-back reminder, to the owner, as clients would get it now. */
  app.post('/rebook/test', requireRole('administrator'), async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `rebook:test:user:${user._id.toHexString()}`, limit: 5, windowSec: 3600 }]);
    return c.json(await sendRebookTest(deps, user));
  });

  app.patch('/', requireRole('administrator'), async (c) => {
    const input = await parseJson(c, settingsSchema);
    if (input.loyaltyCycle !== undefined || input.loyaltyRewards !== undefined) {
      // Every reward must sit on the card (visit ≤ visits per card), one reward per visit.
      const current = await getSettings(deps);
      const cycle = input.loyaltyCycle ?? current.loyaltyCycle;
      const rewards = input.loyaltyRewards ?? current.loyaltyRewards;
      const visits = rewards.map((r) => r.visit);
      if (visits.some((v) => v > cycle) || new Set(visits).size !== visits.length) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Rewards must be on distinct visits within the card', {
          fields: { loyaltyRewards: 'invalid' },
        });
      }
      if (input.loyaltyRewards) input.loyaltyRewards = [...input.loyaltyRewards].sort((a, b) => a.visit - b.visit);
    }
    // The reminders are saved whole: the change over what is saved now.
    const { rebook: rebookPatch, ...rest } = input;
    const rebook = rebookPatch ? mergeRebook((await getSettings(deps)).rebook, rebookPatch) : undefined;
    if (rebook?.enabled && !rebook.channels.email && !rebook.channels.push) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Reminders need a way to be sent', { fields: { 'rebook.channels': 'one_channel' } });
    }
    const values: Partial<StudioSettings> = rebook ? { ...rest, rebook } : rest;
    const now = deps.now();
    await deps.col.settings.updateOne(
      { _id: 'studio' },
      {
        $set: { ...values, updatedAt: now },
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
