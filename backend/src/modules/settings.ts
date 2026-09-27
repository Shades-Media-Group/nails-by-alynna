import type { AppDeps } from '../context';
import { REBOOK_TONES, type I18nText, type RebookSettings, type RebookText, type StudioSettings } from '../db/types';

/** The ranges Admin → Settings accepts for the "come back" reminders (days, and reminders in all). */
export const REBOOK_LIMITS = {
  firstAfterDays: { min: 14, max: 90 },
  repeatEveryDays: { min: 7, max: 60 },
  maxReminders: { min: 1, max: 5 },
} as const;

const emptyI18n = (): I18nText => ({ ro: '', ru: '', en: '' });
const emptyRebookText = (): RebookText => ({ title: emptyI18n(), body: emptyI18n() });

/**
 * "Come back" reminders: the first four weeks after the last completed visit, then every two
 * weeks, three in all, by email and in the app. Empty texts use the built-in wording
 * (notifications/rebook.ts).
 */
export const DEFAULT_REBOOK: RebookSettings = {
  enabled: true,
  firstAfterDays: 28,
  repeatEveryDays: 14,
  maxReminders: 3,
  channels: { email: true, push: true },
  texts: { first: emptyRebookText(), nudge: emptyRebookText(), last: emptyRebookText() },
};

/**
 * Studio defaults; the administrator edits them in Settings. Contact details come from the
 * published price list; seed/defaults.ts brings existing databases up to date.
 */
export const DEFAULT_SETTINGS: StudioSettings = {
  name: 'Nails by Alynna',
  legalName: '',
  legalId: '',
  tagline: {
    ro: 'Unghiile tale. Regulile tale.',
    ru: 'Твои ногти. Твои правила.',
    en: 'Your nails. Your rules.',
  },
  about: {
    ro: 'Spațiul tău personal pentru unghii frumoase și idei îndrăznețe.',
    ru: 'Твоё личное пространство для красивых ногтей и смелых идей.',
    en: 'Consider this your personal space for beautiful nails and bold ideas.',
  },
  address: '',
  city: 'Chișinău',
  mapsUrl: '',
  phone: '+37368230429',
  whatsapp: '',
  viber: '',
  telegram: '',
  instagram: '_nailsbyalynna_',
  email: '',
  timezone: 'Europe/Chisinau',
  currency: 'MDL',
  slotStepMin: 15,
  leadTimeMin: 120,
  horizonDays: 60,
  cancellationWindowHours: 12,
  // Client bookings wait for their master's confirmation (the owner can turn this off).
  requireApproval: true,
  bufferMin: 0,
  // Smart slots: online clients are offered times that keep each master's day compact —
  // back to back, at most 10 free minutes beside a visit, no gap shorter than 1 h 30 min that
  // nobody could book (a gel polish, the shortest main visit, takes 1 h 30 min).
  smartSlots: true,
  maxGapMin: 10,
  minBookableGapMin: 90,
  maxActiveBookings: 3,
  policy: {
    ro: 'Poți anula sau reprograma gratuit până la termenul indicat. După aceea, te rugăm să ne contactezi.',
    ru: 'Отменить или перенести запись можно бесплатно до указанного срока. Позже, пожалуйста, свяжитесь с нами.',
    en: 'You can cancel or reschedule for free until the deadline shown. After that, please contact the studio.',
  },
  // The studio's card: the 4th visit is 15% off, the 8th is 30% off, then a new card starts.
  loyaltyEnabled: true,
  loyaltyCycle: 8,
  loyaltyRewards: [
    { visit: 4, percent: 15 },
    { visit: 8, percent: 30 },
  ],
  rebook: DEFAULT_REBOOK,
};

const inRange = (value: unknown, range: { min: number; max: number }): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;

const textOf = (value: unknown): I18nText => {
  const v = (value ?? {}) as Partial<Record<keyof I18nText, unknown>>;
  const pick = (s: unknown) => (typeof s === 'string' ? s : '');
  return { ro: pick(v.ro), ru: pick(v.ru), en: pick(v.en) };
};

/**
 * The saved reminder settings over the defaults, field by field: a value missing (saved before
 * the field existed) or out of range falls back to the default.
 */
export function resolveRebook(stored: unknown): RebookSettings {
  const s = (stored ?? {}) as Partial<Record<keyof RebookSettings, unknown>>;
  const d = DEFAULT_REBOOK;
  const channels = (s.channels ?? {}) as Partial<Record<'email' | 'push', unknown>>;
  const texts = (s.texts ?? {}) as Partial<Record<string, { title?: unknown; body?: unknown }>>;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    firstAfterDays: inRange(s.firstAfterDays, REBOOK_LIMITS.firstAfterDays) ? s.firstAfterDays : d.firstAfterDays,
    repeatEveryDays: inRange(s.repeatEveryDays, REBOOK_LIMITS.repeatEveryDays) ? s.repeatEveryDays : d.repeatEveryDays,
    maxReminders: inRange(s.maxReminders, REBOOK_LIMITS.maxReminders) ? s.maxReminders : d.maxReminders,
    channels: {
      email: typeof channels.email === 'boolean' ? channels.email : d.channels.email,
      push: typeof channels.push === 'boolean' ? channels.push : d.channels.push,
    },
    texts: Object.fromEntries(
      REBOOK_TONES.map((tone) => [tone, { title: textOf(texts[tone]?.title), body: textOf(texts[tone]?.body) }]),
    ) as RebookSettings['texts'],
  };
}

const APPROVAL_SWITCH = 'requireApprovalDefault';

/**
 * Studios created before bookings waited for confirmation are switched over once, at start-up,
 * unless the owner has already chosen in Settings. Turning it off afterwards sticks.
 */
export async function switchToApprovalOnce(deps: AppDeps): Promise<void> {
  if (await deps.col.meta.findOne({ _id: APPROVAL_SWITCH })) return;
  const now = deps.now();
  await deps.col.settings.updateOne(
    { _id: 'studio', customized: { $ne: 'requireApproval' } },
    { $set: { requireApproval: true, updatedAt: now } },
  );
  await deps.col.meta.updateOne({ _id: APPROVAL_SWITCH }, { $set: { value: true, updatedAt: now } }, { upsert: true });
  caches.delete(deps);
}

// Per-runtime cache (one per Node process), refreshed every 30 s.
const caches = new WeakMap<AppDeps, { value: StudioSettings; expires: number }>();
const CACHE_MS = 30_000;

export async function getSettings(deps: AppDeps): Promise<StudioSettings> {
  const nowMs = Date.now();
  const cached = caches.get(deps);
  if (cached && cached.expires > nowMs) return cached.value;
  const doc = await deps.col.settings.findOne({ _id: 'studio' });
  const value: StudioSettings = { ...DEFAULT_SETTINGS };
  if (doc) {
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof StudioSettings>) {
      if (doc[key] !== undefined && doc[key] !== null) {
        (value as unknown as Record<string, unknown>)[key] = doc[key];
      }
    }
  }
  // A group of settings: a studio that saved it before a field existed gets that field's default.
  value.rebook = resolveRebook(doc?.rebook);
  caches.set(deps, { value, expires: nowMs + CACHE_MS });
  return value;
}

export function invalidateSettingsCache(deps: AppDeps): void {
  caches.delete(deps);
}
