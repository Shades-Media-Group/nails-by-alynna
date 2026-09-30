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
/**
 * A send still marked as going out after this long was cut off (the server restarted mid-send):
 * it may be tried again. Every provider call gives up long before (10–30 s).
 */
export const STALE_SENDING_MS = 2 * 60_000;

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

/**
 * Claims the key (first run wins). A failed one is tried again once its time has come, and one
 * left "sending" by a server that stopped mid-send is taken over.
 */
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
      {
        _id: req.key,
        attempts: { $lt: MAX_ATTEMPTS },
        $or: [
          { status: 'failed', retryAt: { $lte: now } },
          { status: 'sending', updatedAt: { $lte: new Date(now.getTime() - STALE_SENDING_MS) } },
        ],
      },
      { $set: { status: 'sending', updatedAt: now, retryAt: null }, $inc: { attempts: 1 } },
    );
    return retried !== null;
  }
}

/**
 * Sends one notification by email and/or push, as the user's preferences allow, at most once
 * per key (even with several servers and the cron running together), and records the outcome.
 * Both go out at the same moment: the phone never waits for the email (which queues behind the
 * others at the mail provider).
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

  // A retry sends again only what did not go out: an email that went stays sent, and the push
  // that failed alone is tried again (not skipped because the email made it).
  const before = (await deps.col.notificationLog.findOne({ _id: req.key }, { projection: { channels: 1 } }))?.channels ?? {};
  const channels: NotificationLogDoc['channels'] = {
    email: before.email === 'sent' ? 'sent' : 'off',
    push: before.push === 'sent' ? 'sent' : 'off',
  };
  const errors: string[] = [];
  let retryEmail = false;
  let retryPush = false;

  const sendEmail = async () => {
    if (!useEmail || !req.email || channels.email === 'sent') return;
    try {
      await deps.mailer.send(await req.email());
      channels.email = 'sent';
    } catch (error) {
      channels.email = 'failed';
      errors.push((error as Error).message);
      if (!(error instanceof MailError) || error.transient) retryEmail = true;
    }
  };
  const sendPush = async () => {
    if (!usePush || !req.push || channels.push === 'sent') return;
    try {
      const result = await sendPushToUser(deps, req.user._id, req.push.payload, req.push.options);
      channels.push = result.sent > 0 ? 'sent' : result.devices === 0 ? 'no_device' : 'failed';
      if (channels.push === 'failed') {
        // Which push service refused it, and how: the reason to look at, kept with the message.
        const refused = result.deliveries.filter((d) => d.outcome === 'failed').map((d) => `${d.service} ${d.status ?? 'unreachable'}`);
        errors.push(`push refused (${refused.join(', ') || 'no answer'})`);
      }
    } catch (error) {
      channels.push = 'failed';
      errors.push((error as Error).message);
    }
    if (channels.push === 'failed') retryPush = true;
  };
  await Promise.all([sendPush(), sendEmail()]);

  const delivered = channels.email === 'sent' || channels.push === 'sent';
  const anyFailed = channels.email === 'failed' || channels.push === 'failed';
  const retry = retryEmail || retryPush;
  // "failed" while something can still be retried, even when the other channel went out.
  const status: NotificationLogDoc['status'] = retry || (anyFailed && !delivered) ? 'failed' : delivered ? 'sent' : 'skipped';
  const error = errors.length > 0 ? errors.join('; ').slice(0, 500) : null;
  await deps.col.notificationLog.updateOne(
    { _id: req.key },
    {
      $set: {
        status,
        channels,
        error,
        updatedAt: deps.now(),
        retryAt: retry ? new Date(now.getTime() + RETRY_AFTER_MS) : null,
      },
    },
  );
  if (error) console.error(`[notify] ${req.key}: ${error}`);
  return delivered ? 'sent' : status === 'failed' ? 'failed' : 'skipped';
}
