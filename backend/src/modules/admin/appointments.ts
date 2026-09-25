import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES, type AppointmentDoc, type AppointmentStatus, type UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { userSearch } from '../../lib/text';
import { dayRange } from '../../lib/time';
import {
  dateSchema,
  emailSchema,
  idListSchema,
  isoDateTimeSchema,
  objectIdSchema,
  paramId,
  parseJson,
  parseQuery,
  personNameSchema,
  phoneSchema,
} from '../../lib/validation';
import { getSettings } from '../settings';
import {
  placeAppointment,
  rescheduleAppointment,
  staffSummaries,
  toStaffAppointment,
} from '../appointments/service';
import { placeholderEmail } from '../../lib/placeholder-email';

export { placeholderEmail };

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled', 'pending'],
  completed: ['confirmed', 'no_show'],
  no_show: ['confirmed', 'completed'],
  cancelled: ['confirmed'],
};

const STATUS = z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']);


/** Counts per client used for the "no-shows" / "visits" badges on staff views. */
export async function clientBadges(deps: AppDeps, clientIds: ObjectId[]) {
  const unique = [...new Set(clientIds.map((id) => id.toHexString()))].map((id) => new ObjectId(id));
  if (unique.length === 0) return new Map<string, { visits: number; noShows: number }>();
  const rows = await deps.col.appointments
    .aggregate<{ _id: ObjectId; visits: number; noShows: number }>([
      { $match: { clientId: { $in: unique }, status: { $in: ['completed', 'no_show'] } } },
      {
        $group: {
          _id: '$clientId',
          visits: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          noShows: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((r) => [r._id.toHexString(), { visits: r.visits, noShows: r.noShows }]));
}

export function adminAppointmentRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  async function respond(docs: AppointmentDoc[]) {
    const [settings, staff, badges] = await Promise.all([
      getSettings(deps),
      staffSummaries(deps, docs.map((d) => d.staffId)),
      clientBadges(deps, docs.map((d) => d.clientId)),
    ]);
    const now = deps.now();
    return docs.map((d) => ({
      ...toStaffAppointment(d, staff, settings, now),
      clientStats: badges.get(d.clientId.toHexString()) ?? { visits: 0, noShows: 0 },
    }));
  }

  app.get('/', async (c) => {
    const settings = await getSettings(deps);
    const q = parseQuery(
      c,
      z.object({
        from: dateSchema,
        to: dateSchema.optional(),
        status: STATUS.optional(),
        staffId: objectIdSchema.optional(),
        clientId: objectIdSchema.optional(),
      }),
    );
    const to = q.to && q.to >= q.from ? q.to : q.from;
    const start = dayRange(q.from, settings.timezone).start;
    const end = dayRange(to, settings.timezone).end;
    if (end.getTime() - start.getTime() > 62 * 86_400_000) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Range too long', { fields: { to: 'too_long' } });
    }
    const docs = await deps.col.appointments
      .find({
        start: { $gte: start, $lt: end },
        ...(q.status ? { status: q.status } : {}),
        ...(q.staffId ? { staffId: q.staffId } : {}),
        ...(q.clientId ? { clientId: q.clientId } : {}),
      })
      .sort({ start: 1 })
      .limit(500)
      .toArray();
    return c.json({ appointments: await respond(docs) });
  });

  app.get('/:id', async (c) => {
    const doc = await deps.col.appointments.findOne({ _id: paramId(c) });
    if (!doc) throw notFound('Appointment');
    const [appointment] = await respond([doc]);
    return c.json({ appointment });
  });

  const createSchema = z
    .object({
      clientId: objectIdSchema.optional(),
      newClient: z
        .object({
          name: personNameSchema,
          surname: personNameSchema,
          phone: phoneSchema,
          email: emailSchema.optional(),
        })
        .optional(),
      serviceIds: idListSchema(),
      staffId: objectIdSchema.nullable().default(null),
      start: isoDateTimeSchema,
      notes: z.string().trim().max(500, 'too_long').default(''),
      status: z.enum(['pending', 'confirmed']).default('confirmed'),
      force: z.boolean().default(false),
    })
    .refine((v) => Boolean(v.clientId) !== Boolean(v.newClient), { message: 'client_required', path: ['clientId'] });

  app.post('/', async (c) => {
    const actor = c.get('user');
    const input = await parseJson(c, createSchema);
    let client: UserDoc | null = null;

    if (input.clientId) {
      client = await deps.col.users.findOne({ _id: input.clientId, deletedAt: null });
      if (!client) throw notFound('Client');
    } else if (input.newClient) {
      const now = deps.now();
      const _id = new ObjectId();
      const email = input.newClient.email ?? placeholderEmail(_id);
      if (input.newClient.email) {
        const existing = await deps.col.users.findOne({ email });
        if (existing) {
          throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { 'newClient.email': 'taken' } });
        }
      }
      client = {
        _id,
        email,
        name: input.newClient.name,
        surname: input.newClient.surname,
        phone: input.newClient.phone,
        role: 'client',
        locale: 'ro',
        passwordHash: null,
        googleId: null,
        isActive: true,
        bookingBlocked: false,
        tokenVersion: 0,
        notes: '',
        search: userSearch(input.newClient.name, input.newClient.surname, input.newClient.email, input.newClient.phone),
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await deps.col.users.insertOne(client);
      await audit(deps, { actorId: actor._id, action: 'client.create', targetType: 'user', targetId: _id });
    }
    if (!client) throw new AppError(422, 'VALIDATION_ERROR', 'Client required', { fields: { clientId: 'required' } });

    const doc = await placeAppointment(deps, {
      client,
      serviceIds: input.serviceIds,
      staffId: input.staffId,
      start: new Date(input.start),
      notes: input.notes,
      source: 'staff',
      createdBy: actor._id,
      status: input.status,
      enforceSlots: false,
      force: input.force,
    });
    await audit(deps, { actorId: actor._id, action: 'appointment.create_staff', targetType: 'appointment', targetId: doc._id });
    const [appointment] = await respond([doc]);
    return c.json({ appointment }, 201);
  });

  const patchSchema = z.object({
    status: STATUS.optional(),
    staffNotes: z.string().trim().max(1000, 'too_long').optional(),
    notes: z.string().trim().max(500, 'too_long').optional(),
    cancelReason: z.string().trim().max(300, 'too_long').optional(),
    force: z.boolean().default(false),
  });

  app.patch('/:id', async (c) => {
    const actor = c.get('user');
    const id = paramId(c);
    const input = await parseJson(c, patchSchema);
    const doc = await deps.col.appointments.findOne({ _id: id });
    if (!doc) throw notFound('Appointment');
    const now = deps.now();
    const set: Partial<AppointmentDoc> = { updatedAt: now };

    if (input.staffNotes !== undefined) set.staffNotes = input.staffNotes;
    if (input.notes !== undefined) set.notes = input.notes;

    if (input.status && input.status !== doc.status) {
      if (!TRANSITIONS[doc.status].includes(input.status)) {
        throw new AppError(409, 'INVALID_STATUS', `Cannot move from ${doc.status} to ${input.status}`);
      }
      if ((input.status === 'completed' || input.status === 'no_show') && doc.start.getTime() > now.getTime()) {
        throw new AppError(409, 'INVALID_STATUS', 'Only started appointments can be completed or marked no-show');
      }
      if (input.status === 'cancelled') {
        set.cancelledAt = now;
        set.cancelledBy = 'staff';
        set.cancelReason = input.cancelReason ?? '';
      }
      if (doc.status === 'cancelled' && ACTIVE_STATUSES.includes(input.status)) {
        // Restoring re-occupies the slot: it must still be free (unless forced).
        if (!input.force) {
          const clash = await deps.col.appointments.findOne({
            _id: { $ne: doc._id },
            staffId: doc.staffId,
            status: { $in: ACTIVE_STATUSES },
            start: { $lt: doc.end },
            end: { $gt: doc.start },
          });
          if (clash) throw new AppError(409, 'SLOT_TAKEN', 'The slot is taken by another appointment');
        }
        set.placedAt = now;
        set.cancelledAt = null;
        set.cancelledBy = null;
        set.cancelReason = '';
      }
      set.status = input.status;
    }

    const updated = await deps.col.appointments.findOneAndUpdate(
      { _id: id, updatedAt: doc.updatedAt },
      { $set: set },
      { returnDocument: 'after' },
    );
    if (!updated) throw new AppError(409, 'CONFLICT', 'Appointment changed meanwhile; reload and retry');
    if (set.status) {
      await audit(deps, {
        actorId: actor._id,
        action: 'appointment.status',
        targetType: 'appointment',
        targetId: id,
        meta: { from: doc.status, to: set.status },
      });
    }
    const [appointment] = await respond([updated]);
    return c.json({ appointment });
  });

  app.post('/:id/reschedule', async (c) => {
    const actor = c.get('user');
    const id = paramId(c);
    const input = await parseJson(
      c,
      z.object({ start: isoDateTimeSchema, staffId: objectIdSchema.nullable().default(null), force: z.boolean().default(false) }),
    );
    const doc = await deps.col.appointments.findOne({ _id: id });
    if (!doc) throw notFound('Appointment');
    const updated = await rescheduleAppointment(deps, doc, {
      start: new Date(input.start),
      staffId: input.staffId,
      enforceSlots: false,
      force: input.force,
    });
    await audit(deps, { actorId: actor._id, action: 'appointment.reschedule_staff', targetType: 'appointment', targetId: id });
    const [appointment] = await respond([updated]);
    return c.json({ appointment });
  });

  return app;
}
