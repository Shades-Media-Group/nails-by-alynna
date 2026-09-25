import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { audit } from '../../lib/audit';
import { timingSafeEqualStr } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { pushAvailable, removePushSubscription, savePushSubscription, sendPushToUser } from '../../lib/push';
import { enforceRateLimits } from '../../lib/rate-limit';
import { parseJson } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { testPush } from './content';
import { canEmail } from './deliver';
import { applyPrefsPatch, prefsPatchSchema, publicPrefs, resolvePrefs } from './prefs';
import { runNotificationsExclusive } from './scheduler';

/**
 * Push services that browsers hand out subscriptions for. Anything else is refused, so the
 * server never sends requests to an address someone made up (SSRF).
 */
const PUSH_SERVICE_HOSTS = ['.googleapis.com', '.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return PUSH_SERVICE_HOSTS.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1));
  } catch {
    return false;
  }
}

const base64Url = (max: number) => z.string().trim().min(8).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/, 'invalid');

const subscriptionSchema = z.object({
  endpoint: z.string().trim().max(2048).refine(isAllowedPushEndpoint, 'invalid'),
  keys: z.object({ p256dh: base64Url(200), auth: base64Url(64) }),
  expirationTime: z.number().nullable().optional(),
});

/**
 * /api/notifications/* (signed in): preferences, this device's Web Push subscription, a test
 * notification. /api/internal/tick: runs due reminders for an external cron (secret header).
 */
export function notificationRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(deps);

  app.get('/notifications', auth, async (c) => {
    const user = c.get('user');
    const devices = await deps.col.pushSubscriptions.countDocuments({ userId: user._id });
    return c.json({
      prefs: publicPrefs(resolvePrefs(user.notificationPrefs)),
      email: { address: user.email, available: canEmail(user) },
      push: { available: pushAvailable(deps), publicKey: deps.config.push?.publicKey ?? null, devices },
    });
  });

  app.patch('/notifications/prefs', auth, async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `prefs:user:${user._id.toHexString()}`, limit: 120, windowSec: 3600 }]);
    const patch = await parseJson(c, prefsPatchSchema);
    const current = resolvePrefs(user.notificationPrefs);
    const next = applyPrefsPatch(current, patch, deps.now());
    await deps.col.users.updateOne({ _id: user._id }, { $set: { notificationPrefs: next, updatedAt: deps.now() } });

    // Consent to news and offers is personal data processing on its own basis: keep a trail.
    const before = current.marketing;
    const after = next.marketing;
    if (before.email !== after.email || before.push !== after.push) {
      await audit(deps, {
        actorId: user._id,
        action: 'user.marketing_consent',
        targetType: 'user',
        targetId: user._id,
        meta: { email: after.email, push: after.push },
      });
    }
    return c.json({ prefs: publicPrefs(next) });
  });

  // ── Web Push on this device ───────────────────────────────────────────────────
  app.get('/notifications/push/key', auth, (c) => c.json({ publicKey: deps.config.push?.publicKey ?? null }));

  app.post('/notifications/push/subscribe', auth, async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `push:sub:user:${user._id.toHexString()}`, limit: 30, windowSec: 3600 }]);
    if (!pushAvailable(deps)) throw new AppError(503, 'PUSH_UNAVAILABLE', 'Push notifications are not configured');
    const input = await parseJson(c, subscriptionSchema);
    const sessionId = c.get('sessionId');
    await savePushSubscription(deps, {
      userId: user._id,
      sessionId: ObjectId.isValid(sessionId) ? new ObjectId(sessionId) : null,
      subscription: { endpoint: input.endpoint, keys: input.keys },
      userAgent: c.req.header('user-agent'),
    });
    return c.json({ ok: true });
  });

  app.post('/notifications/push/unsubscribe', auth, async (c) => {
    const user = c.get('user');
    const input = await parseJson(c, z.object({ endpoint: z.string().trim().max(2048) }));
    await removePushSubscription(deps, user._id, input.endpoint);
    return c.json({ ok: true });
  });

  /** "Send a test": shows what a reminder looks like on every device that has push on. */
  app.post('/notifications/push/test', auth, async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `push:test:user:${user._id.toHexString()}`, limit: 5, windowSec: 3600 }]);
    if (!pushAvailable(deps)) throw new AppError(503, 'PUSH_UNAVAILABLE', 'Push notifications are not configured');
    const result = await sendPushToUser(deps, user._id, testPush(deps.config.appUrl, user.locale), {
      ttlSec: 300,
      urgency: 'high',
      topic: 'test',
    });
    return c.json({ sent: result.sent, devices: result.devices });
  });

  // ── External cron (Cloudflare Worker trigger, cron-job.org…) ──────────────────────
  app.post('/internal/tick', async (c) => {
    const secret = deps.config.cronSecret;
    const key = c.req.header('x-nba-cron-key') ?? '';
    if (!secret || !key || !timingSafeEqualStr(key, secret)) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }
    const summary = await runNotificationsExclusive(deps);
    return c.json({ ok: true, ...summary });
  });

  return app;
}
