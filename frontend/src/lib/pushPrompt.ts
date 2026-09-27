import type { NotificationPrefs, NotificationPrefsPatch } from '@/services/api/endpoints';
import type { DeviceState } from './push';
import { storage } from './storage';
import { STORAGE_KEYS } from './storageKeys';

/**
 * When the app asks for notifications with a sheet (components/notifications/PushPrompt.tsx).
 *
 * Clients: about 8 s after the app opens (the first time after signing in), once nothing has
 * been touched for a moment on Home, Bookings, Loyalty or Profile. "Not now" asks again 3 days
 * later, then 7; the third "Not now" ends it. Never while notifications are on here, blocked, or
 * switched off by the person. An iPhone in the browser (where notifications can't work) gets
 * the "add the app to the Home Screen" version, once.
 *
 * Staff: on every app open while this device has no notifications and isn't blocked; "Not now"
 * lasts until the next open. Blocked: a banner in the staff app instead (PushBlockedBanner).
 *
 * The client schedule lives on this device, per person. Every rule takes the time as an
 * argument, so tests run on their own clock.
 */

export type PromptAudience = 'client' | 'staff';
/** enable: permission + subscription + preferences · install: add the app to the Home Screen first. */
export type PromptKind = 'enable' | 'install';

export const DAY_MS = 86_400_000;
/** Clients: the app has been open this long… */
export const CLIENT_DELAY_MS = 8_000;
/** …and nothing was touched for this long. */
export const CLIENT_IDLE_MS = 2_500;
/** Staff: a moment for the dashboard to draw first. */
export const STAFF_DELAY_MS = 1_500;
/**
 * Back to the app after this long away counts as a new opening (the same as the staff app's
 * "new requests" sheet, admin/requests/openings.ts).
 */
export const REOPEN_AFTER_MS = 30_000;
/** Days until the next ask after each "Not now", in order. */
export const REASK_AFTER_DAYS = [3, 7, 30] as const;
/** Four asks in all (the first, then after 3, 7 and 30 days): the fourth "Not now" ends it. */
export const MAX_DISMISSALS = 4;
/** Client pages where the sheet may appear (the booking flow and settings never). */
export const CLIENT_PROMPT_PAGES = ['/home', '/bookings', '/loyalty', '/profile'];

export interface PromptSchedule {
  /** "Not now" taps so far. */
  dismissals: number;
  /** Not asked again before this moment (ms since epoch). */
  nextAt: number;
  /** Never again: turned on here, blocked, or switched off by the person. */
  done: boolean;
  /** An iPhone in the browser was told to add the app to the Home Screen (once is enough). */
  installShown: boolean;
}

export const NEW_SCHEDULE: PromptSchedule = {
  dismissals: 0,
  nextAt: 0,
  done: false,
  installShown: false,
};

const scheduleKey = (userId: string) => `${STORAGE_KEYS.pushPrompt}:${userId}`;

/** This device's schedule for `userId`; a missing or damaged one starts over. */
export function readSchedule(userId: string): PromptSchedule {
  const raw = storage.getJson<Partial<PromptSchedule>>(scheduleKey(userId));
  if (!raw || typeof raw !== 'object') return { ...NEW_SCHEDULE };
  const dismissals =
    typeof raw.dismissals === 'number' && raw.dismissals >= 0 ? Math.floor(raw.dismissals) : 0;
  return {
    dismissals,
    nextAt: typeof raw.nextAt === 'number' && Number.isFinite(raw.nextAt) ? raw.nextAt : 0,
    done: raw.done === true,
    installShown: raw.installShown === true,
  };
}

/** Stored best effort: blocked storage just means asking again next time. */
export function saveSchedule(userId: string, schedule: PromptSchedule): void {
  storage.setJson(scheduleKey(userId), schedule);
}

/** "Not now": the next ask moves out (3 days, then 7, then 30), and the fourth ends it. */
export function afterNotNow(schedule: PromptSchedule, now: number): PromptSchedule {
  const dismissals = schedule.dismissals + 1;
  const days = REASK_AFTER_DAYS[Math.min(dismissals, REASK_AFTER_DAYS.length) - 1]!;
  return {
    ...schedule,
    dismissals,
    nextAt: now + days * DAY_MS,
    done: schedule.done || dismissals >= MAX_DISMISSALS,
  };
}

/** Turned on, blocked, or switched off in settings: never ask again on this device. */
export function markPromptDone(userId: string): void {
  saveSchedule(userId, { ...readSchedule(userId), done: true });
}

// ── App openings ──────────────────────────────────────────────────────────────

let opening = 1;
let hiddenAt: number | null = null;
let tracking = false;

/** Counts a new opening when the app comes back after REOPEN_AFTER_MS or more away. */
export function noteVisibility(visible: boolean, now: number): void {
  if (!visible) {
    hiddenAt ??= now;
    return;
  }
  const away = hiddenAt === null ? 0 : now - hiddenAt;
  hiddenAt = null;
  if (away >= REOPEN_AFTER_MS) opening++;
}

/** 1 for the page load, then +1 each time the app returns after REOPEN_AFTER_MS or more away. */
export function currentOpening(): number {
  if (!tracking && typeof document !== 'undefined') {
    tracking = true;
    document.addEventListener('visibilitychange', () =>
      noteVisibility(document.visibilityState === 'visible', Date.now()),
    );
  }
  return opening;
}

/** App notifications switched off for every service message: the person said no in settings. */
export function optedOutOfPush(
  prefs: NotificationPrefs | undefined,
  audience: PromptAudience,
): boolean {
  if (!prefs) return false;
  const service =
    audience === 'staff'
      ? [prefs.staffBookings]
      : [prefs.reminders, prefs.bookingUpdates, prefs.loyalty];
  return service.every((channels) => !channels.push);
}

/**
 * What "Turn on notifications" switches on, in one request: the service messages by app and
 * email. Never news and offers: those need their own consent (Law 133/2011), on the settings page.
 */
export function promptPrefsPatch(audience: PromptAudience): NotificationPrefsPatch {
  return audience === 'staff'
    ? { staffBookings: { email: true, push: true }, bookingUpdates: { email: true, push: true } }
    : {
        reminders: { enabled: true, email: true, push: true },
        bookingUpdates: { email: true, push: true },
        loyalty: { email: true, push: true },
      };
}

export interface PromptFacts {
  audience: PromptAudience;
  device: DeviceState;
  /** The API can send app notifications. */
  serverPush: boolean;
  /** See optedOutOfPush. */
  optedOut: boolean;
  /** Clients only. */
  schedule: PromptSchedule;
  /** Staff only: closed already in this app opening ("Not now" lasts until the next one). */
  snoozed: boolean;
  now: number;
}

/** Which sheet to show now, if any. */
export function promptFor(facts: PromptFacts): PromptKind | null {
  const { device, schedule, now } = facts;
  if (!facts.serverPush || facts.optedOut) return null;
  if (facts.audience === 'staff') {
    if (facts.snoozed) return null;
    if (device === 'off') return 'enable';
    if (device === 'needs-install') return 'install';
    // On, blocked (the banner explains), still installing, or a browser without notifications.
    return null;
  }
  if (schedule.done) return null;
  if (device === 'needs-install') return schedule.installShown ? null : 'install';
  if (device !== 'off') return null;
  if (schedule.dismissals >= MAX_DISMISSALS || now < schedule.nextAt) return null;
  return 'enable';
}
