import type { AppDeps } from '../context';
import type { StudioSettings } from '../db/types';

/** Defaults are placeholders the administrator edits in Settings (address/phone included). */
export const DEFAULT_SETTINGS: StudioSettings = {
  name: 'Nails by Alynna',
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
  phone: '',
  whatsapp: '',
  viber: '',
  telegram: '',
  instagram: '',
  email: '',
  timezone: 'Europe/Chisinau',
  currency: 'MDL',
  slotStepMin: 15,
  leadTimeMin: 120,
  horizonDays: 60,
  cancellationWindowHours: 12,
  requireApproval: false,
  bufferMin: 0,
  maxActiveBookings: 3,
  policy: {
    ro: 'Poți anula sau reprograma gratuit până la termenul indicat. După aceea, te rugăm să ne contactezi.',
    ru: 'Отменить или перенести запись можно бесплатно до указанного срока. Позже, пожалуйста, свяжитесь с нами.',
    en: 'You can cancel or reschedule for free until the deadline shown. After that, please contact the studio.',
  },
};

// Per-runtime cache (one per Node process or Durable Object), refreshed every 30 s.
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
  caches.set(deps, { value, expires: nowMs + CACHE_MS });
  return value;
}

export function invalidateSettingsCache(deps: AppDeps): void {
  caches.delete(deps);
}
