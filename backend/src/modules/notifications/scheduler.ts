import type { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import { ACTIVE_STATUSES, REMINDER_LEADS, type AppointmentDoc, type ReminderLead, type UserDoc } from '../../db/types';
import { appointmentReminderEmail } from '../../lib/emails';
import { MINUTE } from '../../lib/time';
import { getSettings } from '../settings';
import { reminderPush, visitInfo } from './content';
import { MAX_ATTEMPTS, canNotify, deliver } from './deliver';
import { resolvePrefs } from './prefs';

export interface TickSummary {
  /** Upcoming visits looked at. */
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
 * Sends every reminder that is due: for each upcoming visit and each lead time the client
 * chose (1 hour, 2 hours, 1 day before), once the moment has passed. A reminder whose moment
 * came before the visit was booked (or moved) is not sent; when several are due at once only
 * the closest one goes out. Safe to run from several places at once (in-process timer, cron).
 */
export async function runDueNotifications(deps: AppDeps, now: Date = deps.now()): Promise<TickSummary> {
  const started = Date.now();
  const summary: TickSummary = { checked: 0, sent: 0, failed: 0, skipped: 0, duplicates: 0, durationMs: 0 };
  const appointments = await deps.col.appointments
    .find({ status: { $in: ACTIVE_STATUSES }, start: { $gt: now, $lte: new Date(now.getTime() + MAX_LEAD_MS) } })
    .sort({ start: 1 })
    .limit(2000)
    .toArray();
  summary.checked = appointments.length;
  if (appointments.length === 0) return finish(summary, started);

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
  if (plans.length === 0) return finish(summary, started);

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
  return finish(summary, started);
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

/** Checks for due reminders every NOTIFICATIONS_INTERVAL_SEC (0 = off). Returns a stop function. */
export function startNotificationScheduler(deps: AppDeps, intervalSec = deps.config.notificationsIntervalSec): () => void {
  if (intervalSec <= 0) return () => undefined;
  const tick = () => {
    runNotificationsExclusive(deps)
      .then((s) => {
        if (s.sent + s.failed > 0) console.info(`[notify] reminders: ${s.sent} sent, ${s.failed} failed, ${s.skipped} skipped`);
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
