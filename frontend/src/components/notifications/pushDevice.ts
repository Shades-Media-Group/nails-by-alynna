import type { TFunction } from 'i18next';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { currentPlatform } from '@/lib/platform';
import { isAppleDevice, readPushState, type DeviceState, type PushState } from '@/lib/push';
import { notificationsApi } from '@/services/api/endpoints';

/** Profile → Notifications' data (preferences, whether the API has push, its key), shared by every notifications UI. */
export const NOTIFICATIONS_KEY = ['notifications'] as const;
export const notificationsQuery = () => ({
  queryKey: NOTIFICATIONS_KEY,
  queryFn: notificationsApi.get,
});

/** The installed app's name on the Home Screen and in iOS Settings (apple-mobile-web-app-title in index.html). */
export const HOME_SCREEN_NAME = 'Nails by Alynna';

// ── This device, shared ─────────────────────────────────────────────────────────

let current: { userId: string; state: DeviceState } | null = null;
const listeners = new Set<() => void>();

function publish(userId: string, state: DeviceState) {
  current = { userId, state };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    // Nobody shows it any more: read it afresh next time.
    if (listeners.size === 0) current = null;
  };
}

const snapshot = () => current;

/**
 * This device's notifications for `userId`, one value for every place that shows them (the ask
 * after booking, the sheet, the staff banner, Profile → Notifications). Read again whenever the
 * app comes back to the screen, e.g. after allowing notifications in the phone's settings.
 * `serverPush` undefined = not known yet.
 */
export function usePushDevice(
  userId: string | undefined,
  serverPush: boolean | undefined,
): [DeviceState, (state: DeviceState) => void] {
  const shared = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!userId || serverPush === undefined) return;
    let alive = true;
    const read = () => {
      const next: Promise<DeviceState> = serverPush
        ? readPushState(userId)
        : Promise.resolve('unavailable');
      next.then(
        (state) => {
          if (alive) publish(userId, state);
        },
        (error: unknown) => {
          console.warn('[push] could not read this device', error);
          if (alive) publish(userId, 'not-ready');
        },
      );
    };
    read();
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, serverPush]);

  const set = useCallback(
    (state: DeviceState) => {
      if (userId) publish(userId, state);
    },
    [userId],
  );
  return [shared && userId && shared.userId === userId ? shared.state : 'loading', set];
}

// ── Words ───────────────────────────────────────────────────────────────────────

/** "this phone" or "this device". */
export const onPhone = () => {
  const { os } = currentPlatform();
  return os === 'ios' || os === 'android';
};

/** How to allow notifications again on this kind of device (one sentence). */
export function unblockSteps(t: TFunction): string {
  if (isAppleDevice()) return t('push:hint.unblockIos', { app: HOME_SCREEN_NAME });
  if (currentPlatform().os === 'android') return t('push:hint.unblockAndroid');
  return t('push:hint.unblockDesktop');
}

/** One line: notifications are blocked, and how to allow them again. */
export function blockedHint(t: TFunction): string {
  return `${t('push:hint.blocked')} ${unblockSteps(t)}`;
}

/** What a tap on "Turn on" ended in, as a short message (null: nothing to say). */
export function outcomeMessage(
  t: TFunction,
  state: PushState,
): { tone: 'success' | 'info' | 'error'; text: string } | null {
  switch (state) {
    case 'on':
      return {
        tone: 'success',
        text: t(onPhone() ? 'push:result.onPhone' : 'push:result.onDevice'),
      };
    case 'off':
      return { tone: 'info', text: t('push:result.dismissed') };
    case 'denied':
      return { tone: 'error', text: blockedHint(t) };
    case 'needs-install':
      return { tone: 'info', text: t('push:hint.install') };
    case 'not-ready':
      return { tone: 'info', text: t('push:result.notReady') };
    case 'no-service-worker':
      return { tone: 'info', text: t('push:hint.preview') };
    case 'unsupported':
      return { tone: 'error', text: t('push:hint.unsupported') };
    default:
      return null;
  }
}
