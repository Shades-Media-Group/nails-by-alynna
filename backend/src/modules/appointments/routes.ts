import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { enforceRateLimits } from '../../lib/rate-limit';
import { userSearch } from '../../lib/text';
import {
  idListSchema,
  isoDateTimeSchema,
  nailShapeSchema,
  objectIdSchema,
  paramId,
  parseJson,
  parseQuery,
  phoneSchema,
} from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { getSettings } from '../settings';
import {
  clientCanChange,
  placeAppointment,
  rescheduleAppointment,
  staffSummaries,
  toClientAppointment,
} from './service';
import { calendarLinks } from '../calendar/service';
import { notifyBookingChange, notifyStaffOfBooking } from '../notifications';
import { attachPhotos, photosByAppointment, photosToAttach } from '../photos/service';
import { loyaltyTags } from '../loyalty/service';
import { findPromo, givePromoUseBack, promoError } from '../promo/service';

const staffChoice = z
  .union([z.literal('any'), objectIdSchema, z.null()])
  .optional()
  .transform((v) => (v === 'any' || v === undefined ? null : v));

export function appointmentRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/', async (c) => {
    const user = c.get('user');
    const q = parseQuery(
      c,
      z.object({
        scope: z.enum(['upcoming', 'past']).default('upcoming'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
    );
    const now = deps.now();
    const filter =
      q.scope === 'upcoming'
        ? { clientId: user._id, status: { $in: ACTIVE_STATUSES }, end: { $gt: now } }
        : {
            clientId: user._id,
            $or: [{ status: { $nin: ACTIVE_STATUSES } }, { end: { $lte: now } }],
          };
    const docs = await deps.col.appointments
      .find(filter)
      .sort({ start: q.scope === 'upcoming' ? 1 : -1 })
      .limit(q.limit)
      .toArray();
    const [settings, staff] = await Promise.all([
      getSettings(deps),
      staffSummaries(deps, docs.map((d) => d.staffId)),
    ]);
    const [loyalty, calendar] = await Promise.all([loyaltyTags(deps, docs, settings), calendarLinks(deps, docs)]);
    return c.json({ appointments: docs.map((d) => toClientAppointment(d, staff, settings, now, { loyalty, calendar })) });
  });

  /**
   * The client's history at a glance (Home): the visits that took place, and when the first one
   * was. A visit counts once it is marked done, or once a confirmed visit's time is over (few are
   * marked by hand); cancelled ones and no-shows never do.
   */
  app.get('/summary', async (c) => {
    const user = c.get('user');
    const done = {
      clientId: user._id,
      $or: [{ status: 'completed' as const }, { status: 'confirmed' as const, end: { $lte: deps.now() } }],
    };
    const [visits, first] = await Promise.all([
      deps.col.appointments.countDocuments(done),
      deps.col.appointments.find(done).sort({ start: 1 }).limit(1).toArray(),
    ]);
    return c.json({ visits, firstVisitAt: first[0]?.start ?? null });
  });

  app.get('/:id', async (c) => {
    const user = c.get('user');
    const doc = await deps.col.appointments.findOne({ _id: paramId(c), clientId: user._id });
    if (!doc) throw notFound('Appointment');
    const [settings, staff] = await Promise.all([getSettings(deps), staffSummaries(deps, [doc.staffId])]);
    const [loyalty, calendar, photos] = await Promise.all([
      loyaltyTags(deps, [doc], settings),
      calendarLinks(deps, [doc]),
      photosByAppointment(deps, [doc._id]),
    ]);
    return c.json({ appointment: toClientAppointment(doc, staff, settings, deps.now(), { loyalty, calendar, photos }) });
  });

  const createSchema = z.object({
    serviceIds: idListSchema(),
    staffId: staffChoice,
    start: isoDateTimeSchema,
    notes: z.string().trim().max(500, 'too_long').default(''),
    phone: phoneSchema.optional(),
    /** A promo code typed on the confirm step (any case); checked again here and one use held. */
    promoCode: z.string().trim().max(40, 'too_long').optional(),
    /**
     * The nail shape picked on the services step. The app always asks for it, but the API keeps
     * it optional: an installed app that hasn't updated yet books without one.
     */
    nailShape: nailShapeSchema.optional(),
    /** Photos of the nails the client wants (optional, up to three), sent first to /api/photos. */
    photoIds: z.array(objectIdSchema).max(3, 'too_many').default([]),
  });

  app.post('/', async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `book:user:${user._id.toHexString()}`, limit: 20, windowSec: 3600 }]);
    const input = await parseJson(c, createSchema);
    if (user.bookingBlocked) {
      throw new AppError(403, 'BOOKING_BLOCKED', 'Online booking is disabled for this account');
    }

    let client = user;
    if (!user.phone) {
      if (!input.phone) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Phone required', { fields: { phone: 'required' } });
      }
      const now = deps.now();
      await deps.col.users.updateOne(
        { _id: user._id },
        {
          $set: {
            phone: input.phone,
            search: userSearch(user.name, user.surname, user.email, input.phone),
            updatedAt: now,
          },
        },
      );
      client = { ...user, phone: input.phone };
    }

    const settings = await getSettings(deps);
    const now = deps.now();
    const active = await deps.col.appointments.countDocuments({
      clientId: user._id,
      status: { $in: ACTIVE_STATUSES },
      end: { $gt: now },
    });
    if (active >= settings.maxActiveBookings) {
      throw new AppError(409, 'BOOKING_LIMIT', 'Too many upcoming appointments');
    }
    const promo = input.promoCode ? await findPromo(deps, input.promoCode) : null;
    if (input.promoCode && !promo) throw promoError('unknown');
    const photoIds = await photosToAttach(deps, user._id, input.photoIds);

    const doc = await placeAppointment(deps, {
      client,
      serviceIds: input.serviceIds,
      staffId: input.staffId,
      start: new Date(input.start),
      notes: input.notes,
      nailShape: input.nailShape ?? null,
      source: 'client',
      createdBy: user._id,
      enforceSlots: true,
      promo,
    });
    await attachPhotos(deps, photoIds, doc._id);
    await audit(deps, {
      actorId: user._id,
      action: 'appointment.create',
      targetType: 'appointment',
      targetId: doc._id,
      ...(doc.promo ? { meta: { promo: doc.promo.code } } : {}),
    });
    // The client gets "request sent" (or "you're booked"); the master and the owner hear about it.
    const event = doc.status === 'pending' ? 'requested' : 'booked';
    deps.defer(notifyBookingChange(deps, doc._id, event));
    deps.defer(notifyStaffOfBooking(deps, doc._id, event));
    const [staff, loyalty, calendar, photos] = await Promise.all([
      staffSummaries(deps, [doc.staffId]),
      loyaltyTags(deps, [doc], settings),
      calendarLinks(deps, [doc]),
      photosByAppointment(deps, [doc._id]),
    ]);
    return c.json({ appointment: toClientAppointment(doc, staff, settings, now, { loyalty, calendar, photos }) }, 201);
  });

  app.post('/:id/cancel', async (c) => {
    const user = c.get('user');
    const id = paramId(c);
    const input = await parseJson(c, z.object({ reason: z.string().trim().max(300, 'too_long').default('') }));
    const doc = await deps.col.appointments.findOne({ _id: id, clientId: user._id });
    if (!doc) throw notFound('Appointment');
    const settings = await getSettings(deps);
    const now = deps.now();
    if (!ACTIVE_STATUSES.includes(doc.status)) {
      throw new AppError(409, 'INVALID_STATUS', 'Appointment is not active');
    }
    if (!clientCanChange(doc, settings, now)) {
      throw new AppError(403, 'CANCEL_WINDOW_PASSED', 'Too late to cancel online');
    }
    const res = await deps.col.appointments.findOneAndUpdate(
      { _id: id, clientId: user._id, status: { $in: ACTIVE_STATUSES } },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'client',
          cancelReason: input.reason,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (!res) throw new AppError(409, 'INVALID_STATUS', 'Appointment is not active');
    // A cancelled booking gives its promo code's use back.
    if (res.promo) await givePromoUseBack(deps, res.promo.promoId, id);
    await audit(deps, { actorId: user._id, action: 'appointment.cancel', targetType: 'appointment', targetId: id });
    deps.defer(notifyStaffOfBooking(deps, id, 'cancelled'));
    const staff = await staffSummaries(deps, [res.staffId]);
    return c.json({ appointment: toClientAppointment(res, staff, settings, now) });
  });

  app.post('/:id/reschedule', async (c) => {
    const user = c.get('user');
    const id = paramId(c);
    const input = await parseJson(c, z.object({ start: isoDateTimeSchema, staffId: staffChoice }));
    const doc = await deps.col.appointments.findOne({ _id: id, clientId: user._id });
    if (!doc) throw notFound('Appointment');
    const settings = await getSettings(deps);
    const now = deps.now();
    if (!clientCanChange(doc, settings, now)) {
      throw new AppError(403, 'CANCEL_WINDOW_PASSED', 'Too late to reschedule online');
    }
    const updated = await rescheduleAppointment(deps, doc, {
      start: new Date(input.start),
      staffId: input.staffId,
      enforceSlots: true,
    });
    await audit(deps, { actorId: user._id, action: 'appointment.reschedule', targetType: 'appointment', targetId: id });
    deps.defer(notifyStaffOfBooking(deps, id, 'rescheduled'));
    const [staff, loyalty, calendar] = await Promise.all([
      staffSummaries(deps, [updated.staffId]),
      loyaltyTags(deps, [updated], settings),
      calendarLinks(deps, [updated]),
    ]);
    return c.json({ appointment: toClientAppointment(updated, staff, settings, now, { loyalty, calendar }) });
  });

  return app;
}
