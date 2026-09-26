import type { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { NotificationLogDoc, UserDoc } from '../../db/types';
import { isDuplicateKey } from '../../lib/errors';
import { MailError, type MailMessage } from '../../lib/mailer';
import { isPlaceholderEmail } from '../../lib/placeholder-email';
import { pushAvailable, sendPushToUser, type PushPayload, type PushSendOptions } from '../../lib/push';
import { channelsFor, resolvePrefs, type NotificationCategory } from './prefs';

/** Tries per notification when the provider had a temporary problem (then it stays failed). */
export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 5 * 60_000;

export interface DeliveryRequest {
  /** Identity of this notification: the same key is never delivered twice. */
  key: string;
  kind: NotificationLogDoc['kind'];
  category: NotificationCategory;
  user: UserDoc;
  appointmentId?: ObjectId | null;
  /** Built only when email is going to be sent. */
  email?: () => MailMessage | Promise<MailMessage>;
  push?: { payload: PushPayload; options: PushSendOptions };
}

export type DeliveryOutcome = 'sent' | 'failed' | 'skipped' | 'duplicate';

/** Real people with a real inbox: never demo accounts, walk-in placeholders or closed accounts. */
export function canNotify(user: Pick<UserDoc, 'isDemo' | 'isActive' | 'deletedAt'>): boolean {
  return user.isDemo !== true && user.isActive && !user.deletedAt;
}

export function canEmail(user: Pick<UserDoc, 'isDemo' | 'isActive' | 'deletedAt' | 'email'>): boolean {
  return canNotify(user) && !isPlaceholderEmail(user.email);
}

/** Claims the key (first run wins; a failed one is retried once its time has come). */
async function claim(deps: AppDeps, req: DeliveryRequest, now: Date): Promise<boolean> {
  try {
    await deps.col.notificationLog.insertOne({
      _id: req.key,
      kind: req.kind,
      userId: req.user._id,
      appointmentId: req.appointmentId ?? null,
      status: 'sending',
      channels: {},
      attempts: 1,
      error: null,
      createdAt: now,
      updatedAt: now,
      retryAt: null,
    });
    return true;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const retried = await deps.col.notificationLog.findOneAndUpdate(
      { _id: req.key, status: 'failed', retryAt: { $lte: now }, attempts: { $lt: MAX_ATTEMPTS } },
      { $set: { status: 'sending', updatedAt: now, retryAt: null }, $inc: { attempts: 1 } },
    );
    return retried !== null;
  }
}

/**
 * Sends one notification by email and/or push, as the user's preferences allow, at most once
 * per key (even with several servers and the cron running together), and records the outcome.
 */
export async function deliver(deps: AppDeps, req: DeliveryRequest): Promise<DeliveryOutcome> {
  if (!canNotify(req.user)) return 'skipped';
  const wanted = channelsFor(resolvePrefs(req.user.notificationPrefs), req.category);
  const useEmail = wanted.email && Boolean(req.email) && canEmail(req.user);
  const usePush = wanted.push && Boolean(req.push) && pushAvailable(deps);
  // Nothing recorded: switching the notification on later still lets a due one go out.
  if (!useEmail && !usePush) return 'skipped';

  const now = deps.now();
  if (!(await claim(deps, req, now))) return 'duplicate';

  const channels: NotificationLogDoc['channels'] = { email: 'off', push: 'off' };
  const errors: string[] = [];
  let transient = false;

  if (useEmail && req.email) {
    try {
      await deps.mailer.send(await req.email());
      channels.email = 'sent';
    } catch (error) {
      channels.email = 'failed';
      errors.push((error as Error).message);
      if (!(error instanceof MailError) || error.transient) transient = true;
    }
  }
  if (usePush && req.push) {
    try {
      const result = await sendPushToUser(deps, req.user._id, req.push.payload, req.push.options);
      channels.push = result.sent > 0 ? 'sent' : result.devices === 0 ? 'no_device' : 'failed';
      if (channels.push === 'failed') errors.push('push delivery failed');
    } catch (error) {
      channels.push = 'failed';
      errors.push((error as Error).message);
    }
    if (channels.push === 'failed') transient = true;
  }

  const delivered = channels.email === 'sent' || channels.push === 'sent';
  const failed = !delivered && (channels.email === 'failed' || channels.push === 'failed');
  const status: NotificationLogDoc['status'] = delivered ? 'sent' : failed ? 'failed' : 'skipped';
  const error = errors.length > 0 ? errors.join('; ').slice(0, 500) : null;
  await deps.col.notificationLog.updateOne(
    { _id: req.key },
    {
      $set: {
        status,
        channels,
        error,
        updatedAt: deps.now(),
        retryAt: failed && transient ? new Date(now.getTime() + RETRY_AFTER_MS) : null,
      },
    },
  );
  if (error) console.error(`[notify] ${req.key}: ${error}`);
  return status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'skipped';
}
