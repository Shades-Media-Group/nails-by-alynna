import type { ObjectId } from 'bson';
import webpush from 'web-push';
import type { AppConfig } from '../config';
import type { AppDeps } from '../context';
import type { PushSubscriptionDoc } from '../db/types';
import { sha256Hex } from './crypto';
import { truncate } from './text';

/**
 * Web Push (VAPID) to the devices where a user switched notifications on. A subscription is
 * tied to the sign-in session that created it: signing out on that device (or everywhere)
 * stops its notifications, so a shared phone never shows the previous person's reminders.
 */

/** What the service worker (frontend/public/push-sw.js) shows. */
export interface PushPayload {
  title: string;
  body: string;
  /** Same-origin path or absolute app URL opened on tap. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
  /** Language of title and body ('ro', 'ru', 'en'), so the phone reads them out in the right voice. */
  lang?: string;
  /** When it happened (ms since epoch): shown instead of the moment it reached the phone. */
  timestamp?: number;
}

export interface PushSendOptions {
  /** Seconds the push service keeps trying to deliver. */
  ttlSec: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  /** Push services replace an undelivered message with the same topic (≤ 32 URL-safe chars). */
  topic?: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The push service's answer, with its explanation when it refused (Apple: `{"reason":"BadJwtToken"}`). */
export interface PushResponse {
  status: number;
  body?: string;
}

/** Delivers one encrypted message; resolves with the push service's answer, rejects on network errors. */
export interface PushTransport {
  send(target: PushTarget, payload: string, options: PushSendOptions): Promise<PushResponse | number>;
}

/** RFC 8030 Topic: at most 32 characters of the URL-safe base64 alphabet (Apple refuses anything else). */
export const isValidTopic = (topic: string): boolean => /^[A-Za-z0-9_-]{1,32}$/.test(topic);

/** A VAPID token is valid for 12 hours and signed again after 11: Apple asks for at most one new token an hour. */
const VAPID_TOKEN_LIFETIME_SEC = 12 * 3600;
const VAPID_TOKEN_RENEW_AFTER_MS = 11 * 3_600_000;

/**
 * The Authorization header for a push service, one token per service reused until it nears
 * expiry (web-push alone would sign a new one for every message).
 */
export function vapidAuthorizer(push: NonNullable<AppConfig['push']>, clock: () => number = Date.now) {
  const tokens = new Map<string, { header: string; renewAt: number }>();
  return (endpoint: string): string => {
    const audience = new URL(endpoint).origin;
    const now = clock();
    const cached = tokens.get(audience);
    if (cached && now < cached.renewAt) return cached.header;
    const expiration = Math.floor(now / 1000) + VAPID_TOKEN_LIFETIME_SEC;
    const header = webpush.getVapidHeaders(audience, push.subject, push.publicKey, push.privateKey, 'aes128gcm', expiration).Authorization;
    tokens.set(audience, { header, renewAt: now + VAPID_TOKEN_RENEW_AFTER_MS });
    return header;
  };
}

export function webPushTransport(push: NonNullable<AppConfig['push']>): PushTransport {
  const authorization = vapidAuthorizer(push);
  return {
    async send(target, payload, options) {
      const topic = options.topic && isValidTopic(options.topic) ? options.topic : undefined;
      if (options.topic && !topic) console.warn(`[push] topic "${options.topic}" is not a valid RFC 8030 topic; sent without it`);
      try {
        const result = await webpush.sendNotification(target, payload, {
          headers: { Authorization: authorization(target.endpoint) },
          TTL: options.ttlSec,
          urgency: options.urgency,
          topic,
          contentEncoding: 'aes128gcm',
          timeout: 10_000,
        });
        return { status: result.statusCode };
      } catch (error) {
        // A refusal from the push service carries its status and reason; anything else is a network error.
        if (error instanceof webpush.WebPushError) return { status: error.statusCode, body: error.body };
        throw error;
      }
    },
  };
}

const overrides = new WeakMap<AppDeps, PushTransport | null>();
const cached = new WeakMap<AppDeps, PushTransport | null>();

/** Replaces the transport for one runtime (tests, or another provider); null = push off. */
export function setPushTransport(deps: AppDeps, transport: PushTransport | null): void {
  overrides.set(deps, transport);
}

function transportFor(deps: AppDeps): PushTransport | null {
  if (overrides.has(deps)) return overrides.get(deps) ?? null;
  if (!cached.has(deps)) cached.set(deps, deps.config.push ? webPushTransport(deps.config.push) : null);
  return cached.get(deps) ?? null;
}

export function pushAvailable(deps: AppDeps): boolean {
  return transportFor(deps) !== null;
}

// ── The message on the wire ───────────────────────────────────────────────────

/** Marks a Declarative Web Push message (Push API spec; Safari 18.4+ on iPhone, iPad and Mac). */
const DECLARATIVE_WEB_PUSH = 8030;
/**
 * Push services take 4096 bytes of encrypted record, and aes128gcm adds 103 (header, auth tag,
 * padding delimiter): the JSON stays under this, with some margin.
 */
export const MAX_PUSH_MESSAGE_BYTES = 3_900;
const MAX_TITLE = 120;
const MAX_BODY = 400;

/**
 * The JSON a device receives. The top-level title/body/url/tag are what the service worker reads
 * (push-sw.js, old versions included). `web_push` + `notification` carry the same message in the
 * declarative format: Safari 18.4+ shows that one by itself whenever the service worker cannot
 * (removed by the system, failing), so an iPhone never gets a push without a notification.
 * `mutable` still hands the message to the service worker first, which shows its own and
 * refreshes an open app. Other browsers ignore the extra keys.
 */
export function encodePushMessage(payload: PushPayload, appUrl: string): string {
  const title = truncate(payload.title.trim(), MAX_TITLE) || 'Nails by Alynna';
  const origin = new URL(appUrl).origin;
  const target = new URL(payload.url || '/', `${origin}/`);
  const navigate = target.origin === origin ? target.href : `${origin}/`;
  const build = (body: string) =>
    JSON.stringify({
      title,
      body,
      url: payload.url,
      tag: payload.tag,
      lang: payload.lang,
      timestamp: payload.timestamp,
      web_push: DECLARATIVE_WEB_PUSH,
      notification: { title, body, navigate, tag: payload.tag, lang: payload.lang, timestamp: payload.timestamp, silent: false },
      mutable: true,
    });

  let body = truncate(payload.body.trim(), MAX_BODY);
  let message = build(body);
  while (Buffer.byteLength(message) > MAX_PUSH_MESSAGE_BYTES && body) {
    const shorter = body.slice(0, -40).trimEnd();
    body = shorter ? `${shorter}…` : '';
    message = build(body);
  }
  return message;
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export const subscriptionId = (endpoint: string) => sha256Hex(endpoint);

/** Stores (or moves to this user and session) a browser's push subscription. */
export async function savePushSubscription(
  deps: AppDeps,
  opts: { userId: ObjectId; sessionId: ObjectId | null; subscription: PushTarget; userAgent?: string },
): Promise<void> {
  const now = deps.now();
  await deps.col.pushSubscriptions.updateOne(
    { _id: await subscriptionId(opts.subscription.endpoint) },
    {
      $set: {
        userId: opts.userId,
        sessionId: opts.sessionId,
        endpoint: opts.subscription.endpoint,
        keys: opts.subscription.keys,
        userAgent: truncate(opts.userAgent, 200),
        updatedAt: now,
        failures: 0,
      },
      $setOnInsert: { createdAt: now, lastSuccessAt: null },
    },
    { upsert: true },
  );
}

export async function removePushSubscription(deps: AppDeps, userId: ObjectId, endpoint: string): Promise<boolean> {
  const res = await deps.col.pushSubscriptions.deleteOne({ _id: await subscriptionId(endpoint), userId });
  return res.deletedCount === 1;
}

// ── Sending ───────────────────────────────────────────────────────────────────

/** Which push service a subscription belongs to (it follows the browser, not the phone). */
export type PushService = 'apple' | 'google' | 'mozilla' | 'microsoft' | 'other';
/** The kind of device that subscribed, from its browser's user agent. */
export type PushDevice = 'iphone' | 'ipad' | 'android' | 'mac' | 'windows' | 'linux' | 'chromeos' | 'other';

export function pushServiceOf(endpoint: string): PushService {
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host.endsWith('.push.apple.com')) return 'apple';
  if (host === 'googleapis.com' || host.endsWith('.googleapis.com')) return 'google';
  if (host.endsWith('.mozilla.com')) return 'mozilla';
  if (host.endsWith('.notify.windows.com')) return 'microsoft';
  return 'other';
}

/** iPadOS web apps say "Macintosh": an Apple subscription from a "Mac" may be an iPad. */
export function pushDeviceOf(userAgent: string | null | undefined): PushDevice {
  const ua = userAgent ?? '';
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua)) return 'ipad';
  if (/Android/i.test(ua)) return 'android';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux|X11/.test(ua)) return 'linux';
  return 'other';
}

/** One device's delivery, for "Send a test notification". */
export interface PushDeliveryReport {
  service: PushService;
  device: PushDevice;
  /** The push service's HTTP status; null when it could not be reached. */
  status: number | null;
  /** sent: accepted for delivery · gone: that subscription no longer exists (removed) · failed: refused or unreachable. */
  outcome: 'sent' | 'gone' | 'failed';
}

export interface PushResult {
  /** Devices still signed in that could be tried. */
  devices: number;
  sent: number;
  failed: number;
  /** Subscriptions dropped: gone at the push service (404/410, another key) or signed out. */
  removed: number;
  deliveries: PushDeliveryReport[];
}

/** Sends to every signed-in device of the user. Delivery problems are logged, never thrown. */
export async function sendPushToUser(
  deps: AppDeps,
  userId: ObjectId,
  payload: PushPayload,
  options: PushSendOptions,
): Promise<PushResult> {
  const result: PushResult = { devices: 0, sent: 0, failed: 0, removed: 0, deliveries: [] };
  const transport = transportFor(deps);
  if (!transport) return result;
  const col = deps.col.pushSubscriptions;
  const subs = await col.find({ userId }).toArray();
  if (subs.length === 0) return result;

  const now = deps.now();
  const sessionIds = subs.flatMap((s) => (s.sessionId ? [s.sessionId] : []));
  const live = new Set(
    (
      await deps.col.sessions
        .find({ _id: { $in: sessionIds }, userId, revokedAt: null, expiresAt: { $gt: now } }, { projection: { _id: 1 } })
        .toArray()
    ).map((s) => s._id.toHexString()),
  );
  const signedOut = subs.filter((s) => !s.sessionId || !live.has(s.sessionId.toHexString()));
  if (signedOut.length > 0) {
    await col.deleteMany({ _id: { $in: signedOut.map((s) => s._id) } });
    result.removed += signedOut.length;
  }

  const message = encodePushMessage(payload, deps.config.appUrl);
  const targets = subs.filter((s) => !signedOut.includes(s));
  result.devices = targets.length;
  await Promise.all(targets.map((sub) => deliverOne(deps, transport, sub, message, options, result)));
  return result;
}

/** Apple's `reason`, or the start of another push service's error text. */
function reasonOf(body: string | undefined): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    if (typeof parsed.reason === 'string') return parsed.reason;
  } catch {
    // Plain text (FCM, Mozilla).
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * The subscription can never receive anything again: removed on the device (404/410), a device
 * token Apple doesn't know (400 BadWebPushToken), or made for another VAPID key (Apple:
 * VapidPkHashMismatch; FCM: "does not correspond to the sender ID").
 */
export function subscriptionGone(status: number, reason: string): boolean {
  if (status === 404 || status === 410) return true;
  if (status === 400) return /BadWebPushToken|BadDeviceToken/.test(reason);
  return status === 403 && /VapidPkHashMismatch|does not correspond to the sender ID/i.test(reason);
}

const hostOf = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid endpoint';
  }
};

async function deliverOne(
  deps: AppDeps,
  transport: PushTransport,
  sub: PushSubscriptionDoc,
  message: string,
  options: PushSendOptions,
  result: PushResult,
): Promise<void> {
  const col = deps.col.pushSubscriptions;
  const report: PushDeliveryReport = { service: pushServiceOf(sub.endpoint), device: pushDeviceOf(sub.userAgent), status: null, outcome: 'failed' };
  result.deliveries.push(report);
  const host = hostOf(sub.endpoint);
  try {
    const answer = await transport.send({ endpoint: sub.endpoint, keys: sub.keys }, message, options);
    const response: PushResponse = typeof answer === 'number' ? { status: answer } : answer;
    report.status = response.status;
    if (response.status >= 200 && response.status < 300) {
      report.outcome = 'sent';
      result.sent++;
      await col.updateOne({ _id: sub._id }, { $set: { lastSuccessAt: deps.now(), failures: 0 } });
      return;
    }
    const reason = reasonOf(response.body);
    const said = `${host} answered ${response.status}${reason ? ` (${reason})` : ''}`;
    if (subscriptionGone(response.status, reason)) {
      // The app was removed, notifications were revoked, or the subscription is for another key: forget it.
      report.outcome = 'gone';
      result.removed++;
      console.info(`[push] ${said}: subscription removed`);
      await col.deleteOne({ _id: sub._id });
      return;
    }
    result.failed++;
    console.error(`[push] ${said}`);
    await col.updateOne({ _id: sub._id }, { $inc: { failures: 1 } });
  } catch (error) {
    result.failed++;
    console.error(`[push] ${host}: delivery failed: ${(error as Error).message}`);
    await col
      .updateOne({ _id: sub._id }, { $inc: { failures: 1 } })
      .catch((dbError: unknown) => console.error('[push] could not record the failed delivery', dbError));
  }
}
