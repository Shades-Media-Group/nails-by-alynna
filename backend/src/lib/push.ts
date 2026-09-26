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

/** Delivers one encrypted message; resolves with the push service's HTTP status. */
export interface PushTransport {
  send(target: PushTarget, payload: string, options: PushSendOptions): Promise<number>;
}

export function webPushTransport(push: NonNullable<AppConfig['push']>): PushTransport {
  const vapidDetails = { subject: push.subject, publicKey: push.publicKey, privateKey: push.privateKey };
  return {
    async send(target, payload, options) {
      try {
        const result = await webpush.sendNotification(target, payload, {
          vapidDetails,
          TTL: options.ttlSec,
          urgency: options.urgency,
          topic: options.topic,
          contentEncoding: 'aes128gcm',
          timeout: 10_000,
        });
        return result.statusCode;
      } catch (error) {
        // A refusal from the push service carries its status; anything else is a network error.
        if (error instanceof webpush.WebPushError) return error.statusCode;
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

export interface PushResult {
  /** Devices still signed in that could be tried. */
  devices: number;
  sent: number;
  failed: number;
  /** Subscriptions dropped: gone at the push service (404/410) or signed out. */
  removed: number;
}

/** Sends to every signed-in device of the user; never throws. */
export async function sendPushToUser(
  deps: AppDeps,
  userId: ObjectId,
  payload: PushPayload,
  options: PushSendOptions,
): Promise<PushResult> {
  const result: PushResult = { devices: 0, sent: 0, failed: 0, removed: 0 };
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

  const body = JSON.stringify(payload);
  const targets = subs.filter((s) => !signedOut.includes(s));
  result.devices = targets.length;
  await Promise.all(targets.map((sub) => deliverOne(deps, transport, sub, body, options, result)));
  return result;
}

async function deliverOne(
  deps: AppDeps,
  transport: PushTransport,
  sub: PushSubscriptionDoc,
  body: string,
  options: PushSendOptions,
  result: PushResult,
): Promise<void> {
  const col = deps.col.pushSubscriptions;
  try {
    const status = await transport.send({ endpoint: sub.endpoint, keys: sub.keys }, body, options);
    if (status >= 200 && status < 300) {
      result.sent++;
      await col.updateOne({ _id: sub._id }, { $set: { lastSuccessAt: deps.now(), failures: 0 } });
      return;
    }
    if (status === 404 || status === 410) {
      // The browser dropped the subscription (app removed, permission revoked): forget it.
      result.removed++;
      await col.deleteOne({ _id: sub._id });
      return;
    }
    result.failed++;
    console.error(`[push] ${new URL(sub.endpoint).host} answered ${status}`);
    await col.updateOne({ _id: sub._id }, { $inc: { failures: 1 } });
  } catch (error) {
    result.failed++;
    console.error(`[push] delivery failed: ${(error as Error).message}`);
    await col.updateOne({ _id: sub._id }, { $inc: { failures: 1 } }).catch(() => undefined);
  }
}
