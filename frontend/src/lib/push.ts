import { ApiError } from '@/services/api/client';
import { notificationsApi, type PushSubscriptionInput } from '@/services/api/endpoints';
import { currentPlatform } from './platform';
import { storage } from './storage';

/**
 * Web Push on this device, through the service worker vite-plugin-pwa registers (its push and
 * notificationclick handlers live in public/push-sw.js). The development server runs without
 * a service worker, so there this reports 'no-service-worker'.
 *
 * A subscription belongs to the person who switched it on: signing out removes it, and after
 * signing in again it is re-attached only for that same person (never for someone else using
 * the phone).
 */

export type PushState =
  /** The browser cannot receive web notifications at all (or iOS older than 16.4). */
  | 'unsupported'
  /** iPhone/iPad in the browser: iOS delivers web notifications only to the Home Screen app. */
  | 'needs-install'
  /** No service worker (development preview): nothing to receive the notifications. */
  | 'no-service-worker'
  /** The app's service worker is still installing (first visit): try again in a moment. */
  | 'not-ready'
  /** Blocked in the browser or system settings; only the user can undo it there. */
  | 'denied'
  | 'off'
  | 'on';

const OWNER_KEY = 'nba:push-owner';

function isApple(): boolean {
  const { os } = currentPlatform();
  return os === 'ios' || os === 'ipados';
}

/** What this browser can do, before asking anything. */
export function pushCapability(): 'ok' | 'unsupported' | 'needs-install' {
  if (typeof window === 'undefined') return 'unsupported';
  if (isApple() && !currentPlatform().standalone) return 'needs-install';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return supported ? 'ok' : 'unsupported';
}

export const isAppleDevice = isApple;

/** The app's service worker, or null when there is none (development) or it is not active yet. */
async function registration(timeoutMs = 8_000): Promise<ServiceWorkerRegistration | null> {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return null;
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** Why there is no registration: the dev server has none; production is still installing it. */
const noWorker = (): PushState => (import.meta.env.DEV ? 'no-service-worker' : 'not-ready');

/** This device, for `userId`: 'on' only if this person switched it on here. */
export async function readPushState(userId: string): Promise<PushState> {
  const capability = pushCapability();
  if (capability !== 'ok') return capability;
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return noWorker();
  const subscription = await reg.pushManager.getSubscription();
  const mine = storage.get(OWNER_KEY) === userId;
  return subscription && mine && Notification.permission === 'granted' ? 'on' : 'off';
}

/** VAPID public key (base64url) → the bytes PushManager.subscribe expects. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(current: ArrayBuffer | null | undefined, key: Uint8Array): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((byte, i) => byte === key[i]);
}

function toInput(subscription: PushSubscription): PushSubscriptionInput {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    expirationTime: subscription.expirationTime ?? null,
  };
}

/**
 * Asks for permission (call it straight from the tap: Safari only shows the prompt for a user
 * gesture), subscribes this device and registers it with the API for `userId`.
 */
export async function enablePush(userId: string): Promise<PushState> {
  const capability = pushCapability();
  if (capability !== 'ok') return capability;
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';

  const reg = await registration();
  if (!reg) return noWorker();
  const publicKey = await notificationsApi.publicKey();
  if (!publicKey) throw new ApiError(503, 'PUSH_UNAVAILABLE', 'Push notifications are not configured');
  const key = urlBase64ToUint8Array(publicKey);

  let subscription = await reg.pushManager.getSubscription();
  // A subscription made with an older key cannot receive anything any more.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe().catch(() => undefined);
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await notificationsApi.subscribe(toInput(subscription));
  storage.set(OWNER_KEY, userId);
  return 'on';
}

/** Stops notifications on this device (browser subscription and the API's record). */
export async function disablePush(): Promise<void> {
  storage.remove(OWNER_KEY);
  const reg = await registration(1_500);
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await notificationsApi.unsubscribe(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

/**
 * After signing in again on this device: re-attaches the existing subscription to the new
 * session, if it was switched on by this same person. Best effort, never throws.
 */
export async function resyncPush(userId: string): Promise<void> {
  try {
    if (storage.get(OWNER_KEY) !== userId) return;
    if (pushCapability() !== 'ok' || Notification.permission !== 'granted') return;
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    if (subscription) await notificationsApi.subscribe(toInput(subscription));
  } catch {
    // Offline or signed out meanwhile: the Notifications screen tries again.
  }
}
