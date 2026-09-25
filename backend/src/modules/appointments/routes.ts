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
import { loyaltyTags } from '../loyalty/service';

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

  app.get('/:id', async (c) => {
    const user = c.get('user');
    const doc = await deps.col.appointments.findOne({ _id: paramId(c), clientId: user._id });
    if (!doc) throw notFound('Appointment');
    const [settings, staff] = await Promise.all([getSettings(deps), staffSummaries(deps, [doc.staffId])]);
    const [loyalty, calendar] = await Promise.all([loyaltyTags(deps, [doc], settings), calendarLinks(deps, [doc])]);
    return c.json({ appointment: toClientAppointment(doc, staff, settings, deps.now(), { loyalty, calendar }) });
  });

  const createSchema = z.object({
    serviceIds: idListSchema(),
    staffId: staffChoice,
    start: isoDateTimeSchema,
    notes: z.string().trim().max(500, 'too_long').default(''),
    phone: phoneSchema.optional(),
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

    const doc = await placeAppointment(deps, {
      client,
      serviceIds: input.serviceIds,
      staffId: input.staffId,
      start: new Date(input.start),
      notes: input.notes,
      source: 'client',
      createdBy: user._id,
      enforceSlots: true,
    });
    await audit(deps, { actorId: user._id, action: 'appointment.create', targetType: 'appointment', targetId: doc._id });
    const [staff, loyalty, calendar] = await Promise.all([
      staffSummaries(deps, [doc.staffId]),
      loyaltyTags(deps, [doc], settings),
      calendarLinks(deps, [doc]),
    ]);
    return c.json({ appointment: toClientAppointment(doc, staff, settings, now, { loyalty, calendar }) }, 201);
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
    await audit(deps, { actorId: user._id, action: 'appointment.cancel', targetType: 'appointment', targetId: id });
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
    const [staff, loyalty, calendar] = await Promise.all([
      staffSummaries(deps, [updated.staffId]),
      loyaltyTags(deps, [updated], settings),
      calendarLinks(deps, [updated]),
    ]);
    return c.json({ appointment: toClientAppointment(updated, staff, settings, now, { loyalty, calendar }) });
  });

  return app;
}
