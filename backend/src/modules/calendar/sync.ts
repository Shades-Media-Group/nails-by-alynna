import type { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { AppointmentDoc, CalendarConnectionDoc, CalendarProvider, CalendarSyncDoc, I18nText } from '../../db/types';
import { randomToken } from '../../lib/crypto';
import { openSecret } from '../../lib/secret-box';
import { DAY, HOUR, MINUTE } from '../../lib/time';
import { appLink } from '../notifications/content';
import { deliver } from '../notifications/deliver';
import { getSettings } from '../settings';
import * as apple from './caldav';
import { AHEAD_DAYS, FEED_STATUSES, PAST_DAYS, type EventContext } from './feed';
import * as google from './google';
import { CalendarError } from './http';

/*
 * Instant calendar sync: a master's Google Calendar or iCloud calendar connected directly, so a
 * booking shows up there the moment it is made, moved, confirmed or cancelled (a subscribed feed
 * waits for the calendar app to fetch it again: hours, with Google).
 *
 * Every change marks the booking as due in each calendar it belongs in, or was in (a booking
 * given to another master leaves the first one's calendar), and a background run writes what is
 * due right away. What fails for a passing reason is tried again from the minute scheduler, a
 * little later each time; every hour the whole set is compared with what was written, as a net
 * for anything missed. The events carry the same text as the feed (feed.ts).
 */

export const connectionIdOf = (provider: CalendarProvider, staffId: ObjectId) => `${provider}:${staffId.toHexString()}`;

/** Tries per booking before it is left alone (until it changes again, or "Sync now"). */
export const MAX_SYNC_ATTEMPTS = 8;
/** Minutes before the next try, after the 1st, 2nd… failure. */
const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720];
const LEASE_MS = 2 * MINUTE;
const RECONCILE_EVERY_MS = HOUR;
const BATCH = 50;
/** Writes per run at most; the rest waits for the next minute. */
const MAX_PER_RUN = 1000;
/** A booking's sync state is kept this long after its visit. */
const KEEP_MS = 400 * DAY;

interface Writer {
  put(appointment: AppointmentDoc): Promise<void>;
  remove(appointmentId: ObjectId): Promise<void>;
  /** Makes the studio's calendar again (it was deleted there); its new id. */
  recreate(): Promise<string>;
}

function writerFor(deps: AppDeps, conn: CalendarConnectionDoc, secret: string, ctx: EventContext): Writer {
  if (conn.provider === 'google') {
    const auth = { key: conn._id, refreshToken: secret };
    return {
      put: (a) => google.putGoogleEvent(deps, auth, conn.calendarId, a, ctx),
      remove: (id) => google.deleteGoogleEvent(deps, auth, conn.calendarId, id),
      recreate: () => google.createGoogleCalendar(deps, auth, ctx.settings),
    };
  }
  const account = { appleId: conn.account, password: secret };
  return {
    put: (a) => apple.putAppleEvent(deps, account, conn.calendarId, a, ctx),
    remove: (id) => apple.deleteAppleEvent(deps, account, conn.calendarId, id),
    recreate: async () => apple.ensureAppleCalendar(deps, account, conn.homeUrl ?? (await apple.findCalendarHome(deps, account)), ctx.settings.name, null),
  };
}

/** The events are written in the master's language, like their feed. */
async function eventContext(deps: AppDeps, staffId: ObjectId): Promise<EventContext> {
  const staff = await deps.col.staff.findOne({ _id: staffId }, { projection: { userId: 1 } });
  const [settings, user] = await Promise.all([
    getSettings(deps),
    staff?.userId ? deps.col.users.findOne({ _id: staff.userId }, { projection: { locale: 1 } }) : null,
  ]);
  return { settings, locale: user?.locale ?? 'ro', appUrl: deps.config.appUrl };
}

/** Whether a booking's event belongs in this master's calendar: the feed's bookings. */
function belongs(a: AppointmentDoc | null, staffId: ObjectId, now: Date, remote: boolean): a is AppointmentDoc {
  if (!a || !a.staffId.equals(staffId) || !FEED_STATUSES.includes(a.status)) return false;
  const start = a.start.getTime();
  if (start >= now.getTime() + AHEAD_DAYS * DAY) return false;
  // Older visits are left as they are, unless their event is there already (a late "no-show").
  return start >= now.getTime() - PAST_DAYS * DAY || remote;
}

const backoffMs = (attempts: number) => BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1]! * MINUTE;

/** Marks one booking as due in one calendar (a change counted, tries start over). */
async function markDue(deps: AppDeps, conn: Pick<CalendarConnectionDoc, '_id' | 'staffId'>, appointmentId: ObjectId, start: Date | null, now: Date) {
  await deps.col.calendarSync.updateOne(
    { _id: `${conn._id}:${appointmentId.toHexString()}` },
    {
      $set: {
        status: 'pending',
        attempts: 0,
        retryAt: now,
        error: null,
        updatedAt: now,
        ...(start ? { start, expiresAt: new Date(start.getTime() + KEEP_MS) } : {}),
      },
      $inc: { version: 1 },
      $setOnInsert: { connectionId: conn._id, staffId: conn.staffId, appointmentId, remote: false, syncedVersion: null },
    },
    // A booking that no longer exists is only taken out of calendars it was written to.
    { upsert: start !== null },
  );
}

/**
 * After bookings changed (made, moved, confirmed, cancelled, given to another master, edited):
 * writes them into their master's connected calendars and takes them out of any calendar they
 * were in before. Call it in the background after the change is saved:
 * `deps.defer(syncBookingsToCalendars(deps, [appointment._id]))`. Never throws; a failure is
 * tried again later.
 */
export async function syncBookingsToCalendars(deps: AppDeps, appointmentIds: ObjectId[]): Promise<void> {
  try {
    if (appointmentIds.length === 0) return;
    const [appointments, rows] = await Promise.all([
      deps.col.appointments.find({ _id: { $in: appointmentIds } }, { projection: { staffId: 1, start: 1 } }).toArray(),
      deps.col.calendarSync.find({ appointmentId: { $in: appointmentIds } }, { projection: { connectionId: 1, appointmentId: 1 } }).toArray(),
    ]);
    const staffIds = appointments.map((a) => a.staffId);
    if (staffIds.length === 0 && rows.length === 0) return;
    const connections = await deps.col.calendarConnections
      .find({ $or: [{ staffId: { $in: staffIds } }, { _id: { $in: rows.map((r) => r.connectionId) } }] }, { projection: { staffId: 1 } })
      .toArray();
    if (connections.length === 0) return;

    const now = deps.now();
    const starts = new Map(appointments.map((a) => [a._id.toHexString(), a]));
    for (const conn of connections) {
      const due = new Map<string, ObjectId>();
      for (const a of appointments) if (a.staffId.equals(conn.staffId)) due.set(a._id.toHexString(), a._id);
      for (const row of rows) if (row.connectionId === conn._id) due.set(row.appointmentId.toHexString(), row.appointmentId);
      for (const [hex, id] of due) await markDue(deps, conn, id, starts.get(hex)?.start ?? null, now);
    }
    await Promise.all(connections.map((conn) => syncConnection(deps, conn._id)));
  } catch (error) {
    console.error('[calendar] booking sync failed', error instanceof Error ? error.message : error);
  }
}

/** One booking: `syncBookingsToCalendars` for a single id. */
export const syncBookingToCalendars = (deps: AppDeps, appointmentId: ObjectId) => syncBookingsToCalendars(deps, [appointmentId]);

/**
 * Compares the master's bookings with what their calendar was given, and marks as due what
 * differs: a booking never written, one changed since, one that left the set (its event goes).
 * `force` marks everything (connecting, "Sync now", a calendar made again).
 */
async function reconcile(deps: AppDeps, conn: CalendarConnectionDoc, force: boolean): Promise<void> {
  const now = deps.now();
  const from = new Date(now.getTime() - PAST_DAYS * DAY);
  const [appointments, rows] = await Promise.all([
    deps.col.appointments
      .find(
        { staffId: conn.staffId, status: { $in: FEED_STATUSES }, start: { $gte: from, $lt: new Date(now.getTime() + AHEAD_DAYS * DAY) } },
        { projection: { start: 1, updatedAt: 1 } },
      )
      .limit(3000)
      .toArray(),
    deps.col.calendarSync
      .find({ connectionId: conn._id, start: { $gte: from } }, { projection: { appointmentId: 1, status: 1, remote: 1, syncedVersion: 1 } })
      .toArray(),
  ]);
  const byBooking = new Map(rows.map((row) => [row.appointmentId.toHexString(), row]));
  const wanted = new Set<string>();
  for (const a of appointments) {
    const hex = a._id.toHexString();
    wanted.add(hex);
    const row = byBooking.get(hex);
    // Rows already due or waiting for a retry are on their way.
    const written = row && (row.status !== 'synced' || (row.remote && row.syncedVersion?.getTime() === a.updatedAt.getTime()));
    if (force || !written) await markDue(deps, conn, a._id, a.start, now);
  }
  for (const row of rows) {
    if (!wanted.has(row.appointmentId.toHexString()) && row.remote && (force || row.status === 'synced')) {
      await markDue(deps, conn, row.appointmentId, null, now);
    }
  }
  await deps.col.calendarConnections.updateOne({ _id: conn._id }, { $set: { reconciledAt: now } });
}

type RowOutcome = { kind: 'ok' } | { kind: 'auth' | 'gone' | 'pause' | 'failed'; error: string };

/** Writes (or removes) one booking's event; records what the calendar has now. */
async function syncRow(deps: AppDeps, conn: CalendarConnectionDoc, writer: Writer, row: CalendarSyncDoc): Promise<RowOutcome> {
  const appointment = await deps.col.appointments.findOne({ _id: row.appointmentId });
  const wanted = belongs(appointment, conn.staffId, deps.now(), row.remote);
  try {
    if (wanted) await writer.put(appointment);
    else if (row.remote) await writer.remove(row.appointmentId);
  } catch (error) {
    const failure = error instanceof CalendarError ? error : new CalendarError('retry', error instanceof Error ? error.message : String(error));
    if (failure.kind === 'auth') return { kind: 'auth', error: failure.message };
    const now = deps.now();
    const attempts = row.attempts + 1;
    const retryAt = attempts >= MAX_SYNC_ATTEMPTS ? null : new Date(now.getTime() + (failure.retryAfterMs ?? backoffMs(attempts)));
    await deps.col.calendarSync.updateOne(
      { _id: row._id, version: row.version },
      { $set: { status: 'failed', attempts, retryAt, error: failure.message.slice(0, 300), updatedAt: now } },
    );
    return { kind: failure.kind === 'gone' ? 'gone' : failure.retryAfterMs ? 'pause' : 'failed', error: failure.message };
  }
  const now = deps.now();
  const start = appointment?.start ?? row.start;
  const saved = await deps.col.calendarSync.updateOne(
    { _id: row._id, version: row.version },
    {
      $set: {
        status: 'synced',
        remote: wanted,
        syncedVersion: wanted ? appointment.updatedAt : null,
        attempts: 0,
        retryAt: null,
        error: null,
        start,
        expiresAt: new Date(start.getTime() + KEEP_MS),
        updatedAt: now,
      },
    },
  );
  // Changed again meanwhile: it stays due and is written again, but what the calendar has is known.
  if (saved.matchedCount === 0) await deps.col.calendarSync.updateOne({ _id: row._id }, { $set: { remote: wanted } });
  return { kind: 'ok' };
}

// ── Runs: one per calendar at a time (in this process, and across servers by a lease) ──────

const queues = new WeakMap<AppDeps, Map<string, Promise<void>>>();

/**
 * Writes what is due for one connected calendar. Runs for the same calendar follow each other,
 * so a change made during a run is written by the next one. Never throws.
 */
export function syncConnection(deps: AppDeps, connectionId: string, opts: { force?: boolean } = {}): Promise<void> {
  let queue = queues.get(deps);
  if (!queue) queues.set(deps, (queue = new Map()));
  const run = (queue.get(connectionId) ?? Promise.resolve()).then(() => runConnection(deps, connectionId, opts));
  queue.set(connectionId, run);
  void run.then(() => {
    if (queue.get(connectionId) === run) queue.delete(connectionId);
  });
  return run;
}

async function runConnection(deps: AppDeps, id: string, opts: { force?: boolean }): Promise<void> {
  const token = randomToken(12);
  const claimedAt = deps.now();
  // Another server writing to this calendar right now: what is due waits for the next minute.
  let conn = await deps.col.calendarConnections.findOneAndUpdate(
    { _id: id, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: claimedAt } }] },
    { $set: { leaseUntil: new Date(claimedAt.getTime() + LEASE_MS), leaseToken: token } },
    { returnDocument: 'after' },
  );
  if (!conn) return;
  try {
    if (conn.status !== 'active') return;
    const secret = await openSecret(deps.config, conn.secret, conn._id);
    if (!secret) {
      await needsReconnect(deps, conn, 'the saved sign-in can no longer be read (the server key changed)');
      return;
    }
    if (opts.force || !conn.reconciledAt || claimedAt.getTime() - conn.reconciledAt.getTime() >= RECONCILE_EVERY_MS) {
      await reconcile(deps, conn, Boolean(opts.force));
    }
    const ctx = await eventContext(deps, conn.staffId);
    let writer = writerFor(deps, conn, secret, ctx);
    let remade = false;
    let written = 0;
    let lastError: string | null = null;
    run: while (written < MAX_PER_RUN) {
      const due = await deps.col.calendarSync
        .find({ connectionId: id, status: { $in: ['pending', 'failed'] }, retryAt: { $lte: deps.now() } })
        .sort({ retryAt: 1 })
        .limit(BATCH)
        .toArray();
      if (due.length === 0) break;
      for (const row of due) {
        const outcome = await syncRow(deps, conn, writer, row);
        written++;
        if (outcome.kind === 'ok') continue;
        lastError = outcome.error;
        if (outcome.kind === 'auth') {
          await needsReconnect(deps, conn, outcome.error);
          return;
        }
        if (outcome.kind === 'pause') break run;
        if (outcome.kind === 'gone') {
          // The master deleted the studio's calendar: it is made again, once, and filled again.
          if (remade) break run;
          remade = true;
          const fresh = await deps.col.calendarConnections.findOne({ _id: id });
          if (!fresh || fresh.status !== 'active' || fresh.calendarId !== conn.calendarId) return;
          let calendarId: string;
          try {
            calendarId = await writer.recreate();
          } catch (error) {
            if (error instanceof CalendarError && error.kind === 'auth') await needsReconnect(deps, conn, error.message);
            else lastError = error instanceof Error ? error.message : String(error);
            break run;
          }
          await deps.col.calendarConnections.updateOne({ _id: id }, { $set: { calendarId, updatedAt: deps.now() } });
          await deps.col.calendarSync.updateMany({ connectionId: id }, { $set: { remote: false } });
          conn = { ...conn, calendarId };
          writer = writerFor(deps, conn, secret, ctx);
          await reconcile(deps, conn, true);
          continue run;
        }
      }
      await deps.col.calendarConnections.updateOne(
        { _id: id, leaseToken: token },
        { $set: { leaseUntil: new Date(deps.now().getTime() + LEASE_MS) } },
      );
    }
    await deps.col.calendarConnections.updateOne({ _id: id, leaseToken: token }, { $set: { lastSyncAt: deps.now(), lastError } });
  } catch (error) {
    console.error(`[calendar] ${id}: sync run failed`, error instanceof Error ? error.message : error);
  } finally {
    await deps.col.calendarConnections
      .updateOne({ _id: id, leaseToken: token }, { $set: { leaseUntil: null, leaseToken: null } })
      .catch(() => undefined);
  }
}

/**
 * Everything due in every connected calendar: retries whose time has come, and the hourly
 * comparison. Called by the minute scheduler (notifications/scheduler.ts) and the cron tick.
 */
export async function runCalendarSync(deps: AppDeps): Promise<void> {
  const now = deps.now();
  const [due, active] = await Promise.all([
    deps.col.calendarSync.distinct('connectionId', { status: { $in: ['pending', 'failed'] }, retryAt: { $lte: now } }),
    // Calendars waiting to be connected again are left alone.
    deps.col.calendarConnections.find({ status: 'active' }, { projection: { reconciledAt: 1 } }).toArray(),
  ]);
  const waiting = new Set(due);
  for (const conn of active) {
    const compare = !conn.reconciledAt || now.getTime() - conn.reconciledAt.getTime() >= RECONCILE_EVERY_MS;
    if (compare || waiting.has(conn._id)) await syncConnection(deps, conn._id);
  }
}

const running = new WeakMap<AppDeps, Promise<void>>();

/** `runCalendarSync`, one run at a time per server (the timer and the cron share it). Never throws. */
export function runCalendarSyncExclusive(deps: AppDeps): Promise<void> {
  const current = running.get(deps);
  if (current) return current;
  const run = runCalendarSync(deps)
    .catch((error: unknown) => console.error('[calendar] sync run failed', error instanceof Error ? error.message : error))
    .finally(() => running.delete(deps));
  running.set(deps, run);
  return run;
}

// ── When a calendar stops letting the studio in ──────────────────────────────────────────

const RECONNECT = {
  title: { ro: 'Calendarul nu se mai actualizează', ru: 'Календарь больше не обновляется', en: 'Your calendar stopped updating' },
  google: {
    ro: 'Google nu mai permite scrierea programărilor. Conectează din nou Google Calendar în Programul meu.',
    ru: 'Google больше не даёт записывать туда ваши записи. Подключите Google Календарь заново в разделе «Мой график».',
    en: 'Google no longer lets the app write your bookings. Connect Google Calendar again in My schedule.',
  },
  apple: {
    ro: 'iCloud nu mai acceptă parola pentru aplicații. Conectează din nou Apple Calendar în Programul meu.',
    ru: 'iCloud больше не принимает пароль приложения. Подключите Apple Календарь заново в разделе «Мой график».',
    en: 'iCloud no longer accepts the app-specific password. Connect Apple Calendar again in My schedule.',
  },
} satisfies Record<string, I18nText>;

/** Stops writing to a calendar until the master connects it again, and tells them (once). */
async function needsReconnect(deps: AppDeps, conn: CalendarConnectionDoc, reason: string): Promise<void> {
  const now = deps.now();
  const changed = await deps.col.calendarConnections.findOneAndUpdate(
    { _id: conn._id, status: 'active' },
    { $set: { status: 'needs_reconnect', lastError: reason.slice(0, 300), updatedAt: now } },
  );
  if (conn.provider === 'google') google.forgetAccessToken(deps, conn._id);
  if (!changed) return;
  console.warn(`[calendar] ${conn._id}: needs connecting again (${reason})`);
  try {
    const staff = await deps.col.staff.findOne({ _id: conn.staffId }, { projection: { userId: 1 } });
    const user = staff?.userId ? await deps.col.users.findOne({ _id: staff.userId }) : null;
    if (!user) return;
    const locale = user.locale;
    await deliver(deps, {
      key: `calendar:${conn._id}:${now.getTime()}`,
      kind: 'custom',
      category: 'staffBookings',
      user,
      push: {
        payload: {
          title: RECONNECT.title[locale],
          body: RECONNECT[conn.provider][locale],
          url: appLink(deps.config.appUrl, locale, '/admin/schedule'),
          tag: `calendar-${conn.provider}`,
          lang: locale,
        },
        options: { ttlSec: 7 * 86_400, urgency: 'normal' },
      },
    });
  } catch (error) {
    console.error(`[calendar] ${conn._id}: could not tell the master`, error instanceof Error ? error.message : error);
  }
}

// ── What My schedule shows, and disconnecting ─────────────────────────────────────────────

/** "ana.rusu@icloud.com" → "an•••@icloud.com": enough to recognise it, not to copy it. */
export function maskAppleId(appleId: string): string {
  const [local = '', domain = ''] = appleId.split('@');
  return domain ? `${local.slice(0, 2)}•••@${domain}` : `${appleId.slice(0, 2)}•••`;
}

export interface DirectCalendarStatus {
  google: { available: boolean; connected: boolean; needsReconnect: boolean; email: string | null; lastSyncAt: string | null };
  apple: { connected: boolean; needsReconnect: boolean; appleId: string | null; lastSyncAt: string | null };
}

export async function directCalendarStatus(deps: AppDeps, staffId: ObjectId): Promise<DirectCalendarStatus> {
  const docs = await deps.col.calendarConnections.find({ staffId }, { projection: { provider: 1, status: 1, account: 1, lastSyncAt: 1 } }).toArray();
  const googleDoc = docs.find((d) => d.provider === 'google');
  const appleDoc = docs.find((d) => d.provider === 'apple');
  return {
    google: {
      available: Boolean(deps.config.google),
      connected: Boolean(googleDoc),
      needsReconnect: googleDoc?.status === 'needs_reconnect',
      email: googleDoc ? googleDoc.account || null : null,
      lastSyncAt: googleDoc?.lastSyncAt?.toISOString() ?? null,
    },
    apple: {
      connected: Boolean(appleDoc),
      needsReconnect: appleDoc?.status === 'needs_reconnect',
      appleId: appleDoc ? maskAppleId(appleDoc.account) : null,
      lastSyncAt: appleDoc?.lastSyncAt?.toISOString() ?? null,
    },
  };
}

/**
 * Deletes the studio's calendar in the master's account, with every event in it, and gives a
 * Google refresh token back. Best effort: an account that no longer lets the studio in keeps it.
 */
export async function removeRemoteCalendar(deps: AppDeps, conn: CalendarConnectionDoc, secret: string): Promise<void> {
  try {
    if (conn.provider === 'google') {
      // Its own token cache entry: a new connection under the same id must not reuse this one.
      const auth = { key: `${conn._id}:removing`, refreshToken: secret };
      try {
        await google.deleteGoogleCalendar(deps, auth, conn.calendarId);
      } finally {
        google.forgetAccessToken(deps, auth.key);
        await google.revokeGoogleToken(deps, secret);
      }
    } else {
      await apple.deleteAppleCalendar(deps, { appleId: conn.account, password: secret }, conn.calendarId);
    }
  } catch (error) {
    console.warn(`[calendar] ${conn._id}: the calendar could not be deleted (${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * Disconnects a calendar: the saved sign-in and the sync state go at once, and the studio's
 * calendar is deleted in the account in the background. The connection it was, or null.
 */
export async function disconnectCalendar(deps: AppDeps, staffId: ObjectId, provider: CalendarProvider): Promise<CalendarConnectionDoc | null> {
  const id = connectionIdOf(provider, staffId);
  const conn = await deps.col.calendarConnections.findOneAndDelete({ _id: id });
  if (!conn) return null;
  await deps.col.calendarSync.deleteMany({ connectionId: id });
  if (provider === 'google') google.forgetAccessToken(deps, id);
  const secret = await openSecret(deps.config, conn.secret, id);
  if (secret) deps.defer(removeRemoteCalendar(deps, conn, secret));
  return conn;
}
