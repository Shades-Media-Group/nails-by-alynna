import { ObjectId } from 'mongodb';
import type { AppDeps } from '../../context';
import { ACTIVE_STATUSES, type UserDoc } from '../../db/types';
import { bookingUpdateEmail, type BookingChange } from '../../lib/emails';
import type { MailMessage } from '../../lib/mailer';
import type { PushPayload } from '../../lib/push';
import { getSettings } from '../settings';
import { bookingChangePush, visitInfo } from './content';
import { deliver, type DeliveryOutcome } from './deliver';

export type { BookingChange } from '../../lib/emails';

/**
 * Tells the client that the studio confirmed, moved or cancelled their visit (email and/or
 * push, per their "Booking updates" preferences). Call it after the change is saved, from the
 * staff routes, e.g. `deps.defer(notifyBookingChange(deps, appointment._id, 'rescheduled'))`.
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
    const moment = kind === 'cancelled' ? (appointment.cancelledAt ?? appointment.updatedAt) : appointment.start;

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
