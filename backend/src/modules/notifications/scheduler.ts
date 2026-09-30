import type { ObjectId } from 'bson';
import { openDaysForAll } from '../availability/autoOpen';
import type { AppDeps } from '../../context';
import { ACTIVE_STATUSES, REMINDER_LEADS, type AppointmentDoc, type NotificationLogDoc, type ReminderLead, type UserDoc } from '../../db/types';
import { appointmentReminderEmail, feedbackRequestEmail } from '../../lib/emails';
import { HOUR, MINUTE } from '../../lib/time';
import { getSettings } from '../settings';
import { appLink, feedbackPush, reminderPush, visitInfo } from './content';
import { notifyBookingChange, notifyStaffOfBooking, type BookingChange, type StaffBookingEvent } from './booking';
import { MAX_ATTEMPTS, STALE_SENDING_MS, canNotify, deliver } from './deliver';
import { resolvePrefs } from './prefs';
import { sendRebookReminders } from './rebook';
import { removeUnattachedPhotos } from '../photos/service';
import { runCalendarSyncExclusive } from '../calendar/sync';

export interface TickSummary {
  /**
   * Visits looked at: upcoming ones (reminders), ones that just ended (feedback requests) and last
   * visits a few weeks back (come-back reminders).
   */
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Already handled earlier (or by another server at the same moment). */
  duplicates: number;
  durationMs: number;
}

const MAX_LEAD_MS = Math.max(...REMINDER_LEADS) * MINUTE;

export const reminderKey = (appointment: Pick<AppointmentDoc, '_id' | 'start'>, lead: number) =>
  `reminder:${appointment._id.toHexString()}:${appointment.start.getTime()}:${lead}`;

interface Plan {
  appointment: AppointmentDoc;
  user: UserDoc;
  lead: ReminderLead;
  /** Longer leads that came due together with `lead` (e.g. after downtime): covered by it. */
  covered: ReminderLead[];
}

/**
 * Sends everything that is due: the reminders before visits, the "How was your visit?" messages
 * after them, and the reminders to come back weeks later (rebook.ts). Safe to run from several
 * places at once (in-process timer, cron).
 */
export async function runDueNotifications(deps: AppDeps, now: Date = deps.now()): Promise<TickSummary> {
  const started = Date.now();
  const summary: TickSummary = { checked: 0, sent: 0, failed: 0, skipped: 0, duplicates: 0, durationMs: 0 };
  // Working days that open by themselves: a new day at the end of the booking horizon, once a day.
  await openDaysForAll(deps);
  await retryBookingMessages(deps, now, summary);
  // Photos sent for a booking that was never made.
  await removeUnattachedPhotos(deps, now).catch((error: unknown) => console.error('[photos] cleanup failed', error));
  await sendReminders(deps, now, summary);
  await sendFeedbackRequests(deps, now, summary);
  await sendRebookReminders(deps, now, summary);
  return finish(summary, started);
}

const BOOKING_CHANGES: readonly string[] = ['requested', 'booked', 'confirmed', 'rescheduled', 'cancelled'];
const STAFF_EVENTS: readonly string[] = ['requested', 'booked', 'rescheduled', 'cancelled'];

/**
 * Messages about a booking go out the moment it changes (a new request reaches the master's
 * phone at once). One that failed for a passing reason, or was cut off by a restart, is sent
 * again here once its time has come; the key says which visit and which change it was.
 */
async function retryBookingMessages(deps: AppDeps, now: Date, summary: TickSummary): Promise<void> {
  const due = await deps.col.notificationLog
    .find(
      {
        kind: { $in: ['staff_booking', 'booking_update'] },
        attempts: { $lt: MAX_ATTEMPTS },
        $or: [
          { status: 'failed', retryAt: { $lte: now } },
          { status: 'sending', updatedAt: { $lte: new Date(now.getTime() - STALE_SENDING_MS) } },
        ],
      },
      { projection: { _id: 1 }, limit: 50 },
    )
    .toArray();
  const retries = new Set<string>();
  for (const { _id: key } of due) {
    const [scope, id, change] = key.split(':');
    if (scope === 'staff' && id && change && STAFF_EVENTS.includes(change)) retries.add(`staff:${id}:${change}`);
    if (scope === 'booking' && id && change && BOOKING_CHANGES.includes(change)) retries.add(`booking:${id}:${change}`);
  }
  for (const retry of retries) {
    const [scope, id, change] = retry.split(':') as [string, string, string];
    summary.checked++;
    if (scope === 'staff') {
      const reached = await notifyStaffOfBooking(deps, id, change as StaffBookingEvent);
      if (reached > 0) summary.sent += reached;
    } else {
      const outcome = await notifyBookingChange(deps, id, change as BookingChange);
      if (outcome === 'duplicate') summary.duplicates++;
      else summary[outcome]++;
    }
  }
}

/**
 * Every reminder that is due: for each upcoming visit and each lead time the client chose
 * (1 hour, 2 hours, 1 day before), once the moment has passed. A reminder whose moment came
 * before the visit was booked (or moved) is not sent; when several are due at once only the
 * closest one goes out.
 */
async function sendReminders(deps: AppDeps, now: Date, summary: TickSummary): Promise<void> {
  const appointments = await deps.col.appointments
    .find({ status: { $in: ACTIVE_STATUSES }, start: { $gt: now, $lte: new Date(now.getTime() + MAX_LEAD_MS) } })
    .sort({ start: 1 })
    .limit(2000)
    .toArray();
  summary.checked += appointments.length;
  if (appointments.length === 0) return;

  const clientIds = uniqueIds(appointments.map((a) => a.clientId));
  const users = new Map((await deps.col.users.find({ _id: { $in: clientIds } }).toArray()).map((u) => [u._id.toHexString(), u]));

  const plans: Plan[] = [];
  for (const appointment of appointments) {
    const user = users.get(appointment.clientId.toHexString());
    if (!user || !canNotify(user)) continue;
    const prefs = resolvePrefs(user.notificationPrefs);
    if (!prefs.reminders.enabled) continue;
    const bookedAt = (appointment.placedAt ?? appointment.createdAt).getTime();
    const due = prefs.reminders.leadMinutes.filter((lead) => {
      const moment = appointment.start.getTime() - lead * MINUTE;
      return moment <= now.getTime() && moment >= bookedAt;
    });
    if (due.length === 0) continue;
    const lead = Math.min(...due) as ReminderLead;
    plans.push({ appointment, user, lead, covered: due.filter((l) => l !== lead) });
  }
  if (plans.length === 0) return;

  const keys = plans.flatMap((p) => [p.lead, ...p.covered].map((lead) => reminderKey(p.appointment, lead)));
  const existing = new Map(
    (await deps.col.notificationLog.find({ _id: { $in: keys } }, { projection: { status: 1, retryAt: 1, attempts: 1 } }).toArray()).map((d) => [
      d._id,
      d,
    ]),
  );

  const [settings, staff] = await Promise.all([
    getSettings(deps),
    deps.col.staff
      .find({ _id: { $in: uniqueIds(plans.map((p) => p.appointment.staffId)) } }, { projection: { name: 1 } })
      .toArray(),
  ]);
  const masters = new Map(staff.map((s) => [s._id.toHexString(), s.name]));

  for (const plan of plans) {
    const { appointment, user } = plan;
    for (const lead of plan.covered) {
      const key = reminderKey(appointment, lead);
      if (!existing.has(key)) await markCovered(deps, key, user._id, appointment._id, now);
    }

    const key = reminderKey(appointment, plan.lead);
    const previous = existing.get(key);
    const retryable =
      previous?.status === 'failed' && previous.retryAt !== null && previous.retryAt <= now && previous.attempts < MAX_ATTEMPTS;
    if (previous && !retryable) {
      summary.duplicates++;
      continue;
    }

    const locale = user.locale;
    const visit = visitInfo(appointment, {
      appUrl: deps.config.appUrl,
      locale,
      settings,
      master: masters.get(appointment.staffId.toHexString()) ?? null,
      hasAccount: Boolean(user.passwordHash || user.googleId),
    });
    const id = appointment._id.toHexString();
    const outcome = await deliver(deps, {
      key,
      kind: 'reminder',
      category: 'reminders',
      user,
      appointmentId: appointment._id,
      email: () =>
        appointmentReminderEmail({
          to: user.email,
          name: user.name,
          locale,
          timeZone: settings.timezone,
          now,
          visit,
          replyTo: settings.email || undefined,
        }),
      push: {
        payload: reminderPush(visit, id, locale, settings.timezone, now),
        options: {
          ttlSec: Math.max(60, Math.floor((appointment.start.getTime() - now.getTime()) / 1000)),
          urgency: 'high',
          topic: `r${id}`,
        },
      },
    });
    if (outcome === 'duplicate') summary.duplicates++;
    else summary[outcome]++;
  }
}

/** A visit ended at least this long ago before its client is asked how it went (time to get home)… */
const FEEDBACK_ASK_AFTER_MS = HOUR;
/** …and at most this long ago: later, the question would come out of nowhere. */
const FEEDBACK_ASK_UNTIL_MS = 36 * HOUR;

export const feedbackRequestKey = (appointmentId: ObjectId) => `feedback:${appointmentId.toHexString()}`;

/**
 * "How was your visit?" once per completed visit, between one and 36 hours after it ended, by
 * email and push as the client's booking-update preferences allow. Not for visits the client
 * already rated (in the app, from the card on Home), and not for walk-in clients without an
 * account: the page asks them to sign in.
 */
async function sendFeedbackRequests(deps: AppDeps, now: Date, summary: TickSummary): Promise<void> {
  const visits = await deps.col.appointments
    .find({
      status: 'completed',
      end: { $gte: new Date(now.getTime() - FEEDBACK_ASK_UNTIL_MS), $lte: new Date(now.getTime() - FEEDBACK_ASK_AFTER_MS) },
    })
    .sort({ end: 1 })
    .limit(500)
    .toArray();
  summary.checked += visits.length;
  if (visits.length === 0) return;

  const ids = visits.map((a) => a._id);
  const [rated, logged, users] = await Promise.all([
    deps.col.feedback.find({ appointmentId: { $in: ids } }, { projection: { appointmentId: 1 } }).toArray(),
    deps.col.notificationLog
      .find({ _id: { $in: ids.map(feedbackRequestKey) } }, { projection: { status: 1, retryAt: 1, attempts: 1 } })
      .toArray(),
    deps.col.users.find({ _id: { $in: uniqueIds(visits.map((a) => a.clientId)) } }).toArray(),
  ]);
  const ratedIds = new Set(rated.map((f) => String(f.appointmentId)));
  const existing = new Map<string, Pick<NotificationLogDoc, 'status' | 'retryAt' | 'attempts'>>(logged.map((d) => [d._id, d]));
  const byId = new Map(users.map((u) => [u._id.toHexString(), u]));

  const due = visits.filter((appointment) => {
    if (ratedIds.has(appointment._id.toHexString())) return false;
    const user = byId.get(appointment.clientId.toHexString());
    return Boolean(user && canNotify(user) && (user.passwordHash || user.googleId));
  });
  if (due.length === 0) return;

  const [settings, staff] = await Promise.all([
    getSettings(deps),
    deps.col.staff.find({ _id: { $in: uniqueIds(due.map((a) => a.staffId)) } }, { projection: { name: 1 } }).toArray(),
  ]);
  const masters = new Map(staff.map((s) => [s._id.toHexString(), s.name]));

  for (const appointment of due) {
    const key = feedbackRequestKey(appointment._id);
    const previous = existing.get(key);
    const retryable =
      previous?.status === 'failed' && previous.retryAt !== null && previous.retryAt <= now && previous.attempts < MAX_ATTEMPTS;
    if (previous && !retryable) {
      summary.duplicates++;
      continue;
    }

    const user = byId.get(appointment.clientId.toHexString())!;
    const locale = user.locale;
    const id = appointment._id.toHexString();
    const visit = visitInfo(appointment, {
      appUrl: deps.config.appUrl,
      locale,
      settings,
      master: masters.get(appointment.staffId.toHexString()) ?? null,
      hasAccount: true,
    });
    const feedbackUrl = appLink(deps.config.appUrl, locale, `/feedback?visit=${id}`);
    const outcome = await deliver(deps, {
      key,
      kind: 'feedback_request',
      category: 'bookingUpdates',
      user,
      appointmentId: appointment._id,
      email: () =>
        feedbackRequestEmail({
          to: user.email,
          name: user.name,
          locale,
          timeZone: settings.timezone,
          now,
          visit,
          feedbackUrl,
          replyTo: settings.email || undefined,
        }),
      push: {
        payload: feedbackPush(visit, id, feedbackUrl, locale),
        options: { ttlSec: 86_400, urgency: 'normal', topic: `f${id}` },
      },
    });
    if (outcome === 'duplicate') summary.duplicates++;
    else summary[outcome]++;
  }
}

async function markCovered(deps: AppDeps, key: string, userId: ObjectId, appointmentId: ObjectId, now: Date) {
  await deps.col.notificationLog
    .insertOne({
      _id: key,
      kind: 'reminder',
      userId,
      appointmentId,
      status: 'skipped',
      channels: {},
      attempts: 0,
      error: 'covered by a closer reminder',
      createdAt: now,
      updatedAt: now,
      retryAt: null,
    })
    .catch(() => undefined); // another run recorded it first
}

function uniqueIds(ids: ObjectId[]): ObjectId[] {
  const seen = new Map(ids.map((id) => [id.toHexString(), id]));
  return [...seen.values()];
}

function finish(summary: TickSummary, started: number): TickSummary {
  summary.durationMs = Date.now() - started;
  return summary;
}

// ── One run at a time per server; the timer and POST /api/internal/tick share it ─────────

const running = new WeakMap<AppDeps, Promise<TickSummary>>();

export function runNotificationsExclusive(deps: AppDeps): Promise<TickSummary> {
  const current = running.get(deps);
  if (current) return current;
  const run = runDueNotifications(deps).finally(() => running.delete(deps));
  running.set(deps, run);
  return run;
}

/**
 * Checks for everything due (reminders, feedback requests, come-back reminders) every
 * NOTIFICATIONS_INTERVAL_SEC (0 = off), and retries what masters' connected calendars still
 * need (calendar/sync.ts; apart, so a slow calendar never holds up a reminder). Returns a stop
 * function.
 */
export function startNotificationScheduler(deps: AppDeps, intervalSec = deps.config.notificationsIntervalSec): () => void {
  if (intervalSec <= 0) return () => undefined;
  const tick = () => {
    void runCalendarSyncExclusive(deps);
    runNotificationsExclusive(deps)
      .then((s) => {
        if (s.sent + s.failed > 0) console.info(`[notify] reminders, feedback requests and come-back reminders: ${s.sent} sent, ${s.failed} failed, ${s.skipped} skipped`);
      })
      .catch((error: unknown) => console.error('[notify] reminder run failed', error));
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, intervalSec * 1000);
  first.unref?.();
  timer.unref?.();
  console.info(`[notify] reminders checked every ${intervalSec} s`);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
