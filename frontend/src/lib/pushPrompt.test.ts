import { afterEach, describe, expect, it } from 'vitest';
import type { NotificationPrefs } from '@/services/api/endpoints';
import type { DeviceState } from './push';
import {
  DAY_MS,
  MAX_DISMISSALS,
  NEW_SCHEDULE,
  REOPEN_AFTER_MS,
  afterNotNow,
  currentOpening,
  markPromptDone,
  noteVisibility,
  optedOutOfPush,
  promptFor,
  promptPrefsPatch,
  readSchedule,
  saveSchedule,
  type PromptFacts,
  type PromptSchedule,
} from './pushPrompt';
import { STORAGE_KEYS } from './storageKeys';

/*
 * When the app asks for notifications with a sheet. Every rule takes the time as an argument:
 * these tests run on their own clock.
 */

const NOW = Date.UTC(2026, 8, 27, 9, 0);

const client = (
  device: DeviceState,
  schedule: PromptSchedule = NEW_SCHEDULE,
  now = NOW,
): PromptFacts => ({
  audience: 'client',
  device,
  serverPush: true,
  optedOut: false,
  schedule,
  snoozed: false,
  now,
});
const staff = (device: DeviceState, snoozed = false): PromptFacts => ({
  ...client(device),
  audience: 'staff',
  snoozed,
});

const channels = (push: boolean) => ({ email: true, push });
const prefs = (
  push: Partial<Record<keyof NotificationPrefs, boolean>> = {},
): NotificationPrefs => ({
  reminders: { ...channels(push.reminders ?? true), enabled: true, leadMinutes: [60] },
  bookingUpdates: channels(push.bookingUpdates ?? true),
  staffBookings: channels(push.staffBookings ?? true),
  loyalty: channels(push.loyalty ?? true),
  marketing: { email: false, push: push.marketing ?? false, consentAt: null },
});

afterEach(() => window.localStorage.clear());

describe('clients: when the sheet asks', () => {
  it('asks the first time, on a device where notifications are off', () => {
    expect(promptFor(client('off'))).toBe('enable');
  });

  it('backs off after "Not now": 3 days, then 7, then 30, and the fourth "Not now" ends it', () => {
    const once = afterNotNow(NEW_SCHEDULE, NOW);
    expect(once).toMatchObject({ dismissals: 1, nextAt: NOW + 3 * DAY_MS, done: false });
    expect(promptFor(client('off', once, NOW + 3 * DAY_MS - 1))).toBeNull();
    expect(promptFor(client('off', once, NOW + 3 * DAY_MS))).toBe('enable');

    const twice = afterNotNow(once, NOW + 3 * DAY_MS);
    expect(twice).toMatchObject({ dismissals: 2, nextAt: NOW + 10 * DAY_MS, done: false });
    expect(promptFor(client('off', twice, NOW + 10 * DAY_MS - 1))).toBeNull();
    expect(promptFor(client('off', twice, NOW + 10 * DAY_MS))).toBe('enable');

    const thrice = afterNotNow(twice, NOW + 10 * DAY_MS);
    expect(thrice).toMatchObject({ dismissals: 3, nextAt: NOW + 40 * DAY_MS, done: false });
    expect(promptFor(client('off', thrice, NOW + 40 * DAY_MS - 1))).toBeNull();
    expect(promptFor(client('off', thrice, NOW + 40 * DAY_MS))).toBe('enable');

    const fourth = afterNotNow(thrice, NOW + 40 * DAY_MS);
    expect(fourth.dismissals).toBe(MAX_DISMISSALS);
    expect(fourth.done).toBe(true);
    expect(promptFor(client('off', fourth, NOW + 400 * DAY_MS))).toBeNull();
  });

  it('never asks while notifications are on here, blocked, or can not work in this browser', () => {
    for (const device of [
      'on',
      'denied',
      'unsupported',
      'no-service-worker',
      'unavailable',
      'loading',
    ] as const) {
      expect(promptFor(client(device))).toBeNull();
    }
    // Still installing its service worker: not now, the next look decides.
    expect(promptFor(client('not-ready'))).toBeNull();
  });

  it('never asks someone who switched notifications off, or when the API has no push', () => {
    expect(promptFor({ ...client('off'), optedOut: true })).toBeNull();
    expect(promptFor({ ...client('off'), serverPush: false })).toBeNull();
    expect(promptFor(client('off', { ...NEW_SCHEDULE, done: true }))).toBeNull();
    // "Switched off" = no app notifications for any service message; news don't count.
    expect(
      optedOutOfPush(prefs({ reminders: false, bookingUpdates: false, loyalty: false }), 'client'),
    ).toBe(true);
    expect(optedOutOfPush(prefs({ reminders: false, loyalty: false }), 'client')).toBe(false);
    expect(optedOutOfPush(prefs({ marketing: false }), 'client')).toBe(false);
    expect(optedOutOfPush(undefined, 'client')).toBe(false);
  });

  it('shows an iPhone in the browser how to install the app, once', () => {
    expect(promptFor(client('needs-install'))).toBe('install');
    expect(promptFor(client('needs-install', { ...NEW_SCHEDULE, installShown: true }))).toBeNull();
  });
});

describe('staff: when the sheet asks', () => {
  it('asks on every open while this device is not subscribed, with no backoff', () => {
    expect(promptFor(staff('off'))).toBe('enable');
    // A client's backoff never applies to staff.
    expect(
      promptFor({ ...staff('off'), schedule: { ...NEW_SCHEDULE, dismissals: 3, done: true } }),
    ).toBe('enable');
    expect(promptFor(staff('needs-install'))).toBe('install');
  });

  it('"Not now" lasts until the next opening: a reload, or back after 30 s away', () => {
    expect(promptFor(staff('off', true))).toBeNull();
    expect(promptFor(staff('off', false))).toBe('enable');

    const first = currentOpening();
    // A quick look at another app is not a new opening…
    noteVisibility(false, NOW);
    noteVisibility(true, NOW + REOPEN_AFTER_MS - 1);
    expect(currentOpening()).toBe(first);
    // …coming back after half a minute or more is.
    noteVisibility(false, NOW + 60_000);
    noteVisibility(true, NOW + 60_000 + REOPEN_AFTER_MS);
    expect(currentOpening()).toBe(first + 1);
  });

  it('leaves blocked devices to the banner, and respects booking notifications switched off', () => {
    expect(promptFor(staff('denied'))).toBeNull();
    expect(promptFor(staff('on'))).toBeNull();
    expect(optedOutOfPush(prefs({ staffBookings: false }), 'staff')).toBe(true);
    expect(optedOutOfPush(prefs({ bookingUpdates: false }), 'staff')).toBe(false);
  });
});

describe('what "Turn on notifications" switches on, in one request', () => {
  it('clients: reminders, booking updates and loyalty by app and email, never news and offers', () => {
    const patch = promptPrefsPatch('client');
    expect(patch).toEqual({
      reminders: { enabled: true, email: true, push: true },
      bookingUpdates: { email: true, push: true },
      loyalty: { email: true, push: true },
    });
    expect(patch).not.toHaveProperty('marketing');
  });

  it("staff: clients' bookings and booking updates by app and email", () => {
    expect(promptPrefsPatch('staff')).toEqual({
      staffBookings: { email: true, push: true },
      bookingUpdates: { email: true, push: true },
    });
  });
});

describe('the schedule on this device', () => {
  it('is kept per person, and a damaged or missing one starts over', () => {
    saveSchedule('u1', afterNotNow(NEW_SCHEDULE, NOW));
    expect(readSchedule('u1')).toEqual({
      dismissals: 1,
      nextAt: NOW + 3 * DAY_MS,
      done: false,
      installShown: false,
    });
    expect(readSchedule('u2')).toEqual(NEW_SCHEDULE);

    window.localStorage.setItem(`${STORAGE_KEYS.pushPrompt}:u3`, '{not json');
    expect(readSchedule('u3')).toEqual(NEW_SCHEDULE);
    window.localStorage.setItem(
      `${STORAGE_KEYS.pushPrompt}:u4`,
      JSON.stringify({ dismissals: -2, nextAt: 'soon', done: 'yes' }),
    );
    expect(readSchedule('u4')).toEqual(NEW_SCHEDULE);
  });

  it('remembers "never again" (turned on, blocked, or switched off in settings)', () => {
    markPromptDone('u1');
    expect(readSchedule('u1').done).toBe(true);
    expect(promptFor(client('off', readSchedule('u1')))).toBeNull();
  });

  it('still works when storage is blocked (asks again next time instead of failing)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      expect(() => saveSchedule('u1', afterNotNow(NEW_SCHEDULE, NOW))).not.toThrow();
      expect(readSchedule('u1')).toEqual(NEW_SCHEDULE);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
