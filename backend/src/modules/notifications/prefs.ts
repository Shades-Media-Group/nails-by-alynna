import { z } from 'zod';
import { REMINDER_LEADS, type ChannelPrefs, type NotificationPrefs, type ReminderLead } from '../../db/types';

/**
 * Notification preferences. Service messages (reminders, changes to a booking) are on by
 * default; news and offers are opt-in only (Law 133/2011 on personal data, GDPR-style
 * consent), and switching them on is recorded with a timestamp.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
  reminders: { enabled: true, leadMinutes: [60], email: true, push: true },
  bookingUpdates: { email: true, push: true },
  staffBookings: { email: true, push: true },
  loyalty: { email: false, push: true },
  marketing: { email: false, push: false, consentAt: null },
};

export type NotificationCategory = 'reminders' | 'bookingUpdates' | 'staffBookings' | 'loyalty' | 'marketing';

const isLead = (value: unknown): value is ReminderLead => (REMINDER_LEADS as readonly unknown[]).includes(value);

function normalizeLeads(leads: readonly unknown[] | undefined): ReminderLead[] {
  const valid = [...new Set((leads ?? []).filter(isLead))].sort((a, b) => a - b);
  return valid.length > 0 ? valid : [...DEFAULT_PREFS.reminders.leadMinutes];
}

const pickChannels = (value: Partial<ChannelPrefs> | undefined, fallback: ChannelPrefs): ChannelPrefs => ({
  email: typeof value?.email === 'boolean' ? value.email : fallback.email,
  push: typeof value?.push === 'boolean' ? value.push : fallback.push,
});

/** Stored preferences over the defaults (documents from before a field existed stay valid). */
export function resolvePrefs(stored: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  const s = stored ?? {};
  return {
    reminders: {
      ...pickChannels(s.reminders, DEFAULT_PREFS.reminders),
      enabled: typeof s.reminders?.enabled === 'boolean' ? s.reminders.enabled : DEFAULT_PREFS.reminders.enabled,
      leadMinutes: normalizeLeads(s.reminders?.leadMinutes ?? DEFAULT_PREFS.reminders.leadMinutes),
    },
    bookingUpdates: pickChannels(s.bookingUpdates, DEFAULT_PREFS.bookingUpdates),
    staffBookings: pickChannels(s.staffBookings, DEFAULT_PREFS.staffBookings),
    loyalty: pickChannels(s.loyalty, DEFAULT_PREFS.loyalty),
    marketing: { ...pickChannels(s.marketing, DEFAULT_PREFS.marketing), consentAt: s.marketing?.consentAt ?? null },
    updatedAt: s.updatedAt,
  };
}

const channelPatch = z.object({ email: z.boolean(), push: z.boolean() }).partial();

export const prefsPatchSchema = z
  .object({
    reminders: channelPatch
      .extend({
        enabled: z.boolean(),
        leadMinutes: z
          .array(z.union([z.literal(60), z.literal(120), z.literal(1440)]))
          .min(1, 'required')
          .max(REMINDER_LEADS.length, 'too_many'),
      })
      .partial(),
    bookingUpdates: channelPatch,
    staffBookings: channelPatch,
    loyalty: channelPatch,
    marketing: channelPatch,
  })
  .partial();

export type PrefsPatch = z.infer<typeof prefsPatchSchema>;

export function applyPrefsPatch(current: NotificationPrefs, patch: PrefsPatch, now: Date): NotificationPrefs {
  const marketing = { ...current.marketing, ...patch.marketing };
  const wasOn = current.marketing.email || current.marketing.push;
  const isOn = marketing.email || marketing.push;
  return {
    reminders: {
      ...current.reminders,
      ...patch.reminders,
      leadMinutes: normalizeLeads(patch.reminders?.leadMinutes ?? current.reminders.leadMinutes),
    },
    bookingUpdates: { ...current.bookingUpdates, ...patch.bookingUpdates },
    staffBookings: { ...current.staffBookings, ...patch.staffBookings },
    loyalty: { ...current.loyalty, ...patch.loyalty },
    // Consent is dated when it is given; withdrawing it clears the date.
    marketing: { ...marketing, consentAt: isOn ? (wasOn ? (current.marketing.consentAt ?? now) : now) : null },
    updatedAt: now,
  };
}

/** The API shape (no internal dates except the consent moment). */
export function publicPrefs(prefs: NotificationPrefs) {
  return {
    reminders: {
      enabled: prefs.reminders.enabled,
      leadMinutes: prefs.reminders.leadMinutes,
      email: prefs.reminders.email,
      push: prefs.reminders.push,
    },
    bookingUpdates: { ...prefs.bookingUpdates },
    staffBookings: { ...prefs.staffBookings },
    loyalty: { ...prefs.loyalty },
    marketing: {
      email: prefs.marketing.email,
      push: prefs.marketing.push,
      consentAt: prefs.marketing.consentAt ? prefs.marketing.consentAt.toISOString() : null,
    },
  };
}

/** Which channels a category may use for this user, before device/address checks. */
export function channelsFor(prefs: NotificationPrefs, category: NotificationCategory): ChannelPrefs {
  if (category === 'reminders' && !prefs.reminders.enabled) return { email: false, push: false };
  const c = prefs[category];
  return { email: c.email, push: c.push };
}
