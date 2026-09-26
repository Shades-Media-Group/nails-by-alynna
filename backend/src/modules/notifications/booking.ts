import { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import { ACTIVE_STATUSES, type UserDoc } from '../../db/types';
import { bookingUpdateEmail, staffBookingEmail, type BookingChange, type StaffBookingEvent } from '../../lib/emails';
import type { MailMessage } from '../../lib/mailer';
import type { PushPayload } from '../../lib/push';
import { getSettings } from '../settings';
import { appLink, bookingChangePush, staffBookingPush, visitInfo } from './content';
import { deliver, type DeliveryOutcome } from './deliver';

export type { BookingChange, StaffBookingEvent } from '../../lib/emails';

/**
 * Tells the client what happened to their visit (email and/or push, per their "Booking
 * updates" preferences): their request reached the studio, they are booked, or the studio
 * confirmed, moved or cancelled it. Call it after the change is saved, e.g.
 * `deps.defer(notifyBookingChange(deps, appointment._id, 'rescheduled'))`.
 *
 * - Never throws; resolves with what happened.
 * - Idempotent: the same change (visit + kind + time) is announced once, even if called twice.
 * - Says nothing for visits already in the past, for demo/closed accounts, when the saved
 *   status does not match `kind`, or for cancellations the client made themselves.
 */
export async function notifyBookingChange(
  deps: AppDeps,
  appointmentId: ObjectId | string,
  kind: BookingChange,
): Promise<DeliveryOutcome> {
  try {
    if (typeof appointmentId === 'string' && !ObjectId.isValid(appointmentId)) return 'skipped';
    const id = typeof appointmentId === 'string' ? new ObjectId(appointmentId) : appointmentId;
    const appointment = await deps.col.appointments.findOne({ _id: id });
    const now = deps.now();
    if (!appointment || appointment.start.getTime() <= now.getTime()) return 'skipped';
    if (kind === 'cancelled' && (appointment.status !== 'cancelled' || appointment.cancelledBy === 'client')) return 'skipped';
    if (kind === 'confirmed' && appointment.status !== 'confirmed') return 'skipped';
    if (kind === 'requested' && appointment.status !== 'pending') return 'skipped';
    if (kind === 'booked' && appointment.status !== 'confirmed') return 'skipped';
    if (kind === 'rescheduled' && !ACTIVE_STATUSES.includes(appointment.status)) return 'skipped';

    const user = await deps.col.users.findOne({ _id: appointment.clientId });
    if (!user) return 'skipped';
    const [settings, master] = await Promise.all([
      getSettings(deps),
      deps.col.staff.findOne({ _id: appointment.staffId }, { projection: { name: 1 } }),
    ]);
    const locale = user.locale;
    const visit = visitInfo(appointment, {
      appUrl: deps.config.appUrl,
      locale,
      settings,
      master: master?.name ?? null,
      hasAccount: Boolean(user.passwordHash || user.googleId),
    });
    const hex = id.toHexString();
    const moment =
      kind === 'cancelled'
        ? (appointment.cancelledAt ?? appointment.updatedAt)
        : kind === 'requested' || kind === 'booked'
          ? appointment.createdAt
          : appointment.start;

    return await deliver(deps, {
      key: `booking:${hex}:${kind}:${moment.getTime()}`,
      kind: 'booking_update',
      category: 'bookingUpdates',
      user,
      appointmentId: id,
      email: () =>
        bookingUpdateEmail({
          to: user.email,
          name: user.name,
          locale,
          timeZone: settings.timezone,
          now,
          kind,
          visit,
          replyTo: settings.email || undefined,
        }),
      push: {
        payload: bookingChangePush(visit, hex, kind, locale, settings.timezone, now),
        options: { ttlSec: 86_400, urgency: 'high', topic: `b${hex}` },
      },
    });
  } catch (error) {
    console.error(`[notify] booking ${kind} notification failed`, error);
    return 'failed';
  }
}

/**
 * Tells the master of the visit and the owner(s) that a client asked for, booked, moved or
 * cancelled it (email and/or push, per each one's "Clients' bookings" preferences), with a
 * link straight to the booking in the staff app. Call it after the client's change is saved.
 * Never throws; resolves with how many people it reached. Each person hears about each
 * change once, even if called twice.
 */
export async function notifyStaffOfBooking(
  deps: AppDeps,
  appointmentId: ObjectId | string,
  event: StaffBookingEvent,
): Promise<number> {
  try {
    if (typeof appointmentId === 'string' && !ObjectId.isValid(appointmentId)) return 0;
    const id = typeof appointmentId === 'string' ? new ObjectId(appointmentId) : appointmentId;
    const appointment = await deps.col.appointments.findOne({ _id: id });
    const now = deps.now();
    if (!appointment || appointment.end.getTime() <= now.getTime()) return 0;
    if (event === 'requested' && appointment.status !== 'pending') return 0;
    if (event === 'booked' && appointment.status !== 'confirmed') return 0;
    if (event === 'cancelled' && (appointment.status !== 'cancelled' || appointment.cancelledBy !== 'client')) return 0;
    if (event === 'rescheduled' && !ACTIVE_STATUSES.includes(appointment.status)) return 0;

    const [settings, master, owners] = await Promise.all([
      getSettings(deps),
      deps.col.staff.findOne({ _id: appointment.staffId }, { projection: { name: 1, userId: 1 } }),
      deps.col.users.find({ role: 'administrator', isActive: true, deletedAt: null }).toArray(),
    ]);
    const recipients = new Map<string, UserDoc>(owners.map((user) => [user._id.toHexString(), user]));
    if (master?.userId) {
      const own = await deps.col.users.findOne({ _id: master.userId, isActive: true, deletedAt: null });
      if (own) recipients.set(own._id.toHexString(), own);
    }
    // Staff booking a visit for themselves as a client don't need to be told about it.
    recipients.delete(appointment.clientId.toHexString());

    const hex = id.toHexString();
    const client = {
      name: [appointment.client.name, appointment.client.surname].filter(Boolean).join(' '),
      phone: appointment.client.phone || null,
    };
    const moment =
      event === 'cancelled'
        ? (appointment.cancelledAt ?? appointment.updatedAt)
        : event === 'rescheduled'
          ? appointment.start
          : appointment.createdAt;

    let reached = 0;
    for (const user of recipients.values()) {
      const locale = user.locale;
      const visit = visitInfo(appointment, { appUrl: deps.config.appUrl, locale, settings, master: master?.name ?? null, hasAccount: true });
      const openUrl = appLink(deps.config.appUrl, locale, `/admin/appointments/${hex}`);
      const outcome = await deliver(deps, {
        key: `staff:${hex}:${event}:${moment.getTime()}:${user._id.toHexString()}`,
        kind: 'staff_booking',
        category: 'staffBookings',
        user,
        appointmentId: id,
        email: () =>
          staffBookingEmail({
            to: user.email,
            name: user.name,
            locale,
            timeZone: settings.timezone,
            now,
            event,
            visit,
            client,
            openUrl,
            settingsUrl: appLink(deps.config.appUrl, locale, '/profile/notifications'),
          }),
        push: {
          payload: staffBookingPush(visit, client.name, event, openUrl, locale, settings.timezone, now),
          options: { ttlSec: 86_400, urgency: 'high', topic: `s${hex}` },
        },
      });
      if (outcome === 'sent') reached++;
    }
    return reached;
  } catch (error) {
    console.error(`[notify] staff ${event} notification failed`, error);
    return 0;
  }
}

/**
 * Generic hook for other features (e.g. loyalty rewards, news): sends a message the user's
 * preferences allow for `category`, once per `key`. Never throws.
 */
export async function notifyUser(
  deps: AppDeps,
  opts: {
    userId: ObjectId;
    category: 'loyalty' | 'marketing';
    key: string;
    push?: PushPayload;
    email?: (user: UserDoc) => MailMessage;
  },
): Promise<DeliveryOutcome> {
  try {
    const user = await deps.col.users.findOne({ _id: opts.userId });
    if (!user) return 'skipped';
    const email = opts.email;
    return await deliver(deps, {
      key: opts.key,
      kind: 'custom',
      category: opts.category,
      user,
      email: email ? () => email(user) : undefined,
      push: opts.push ? { payload: opts.push, options: { ttlSec: 7 * 86_400, urgency: 'normal' } } : undefined,
    });
  } catch (error) {
    console.error(`[notify] ${opts.category} notification failed`, error);
    return 'failed';
  }
}
