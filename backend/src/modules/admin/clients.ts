import { Hono } from 'hono';
import { ObjectId, type Filter } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES, type UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, isDuplicateKey, notFound } from '../../lib/errors';
import { escapeRegex, searchQuery, userSearch } from '../../lib/text';
import {
  emailSchema,
  paramId,
  parseJson,
  parseQuery,
  personNameSchema,
  phoneSchema,
} from '../../lib/validation';
import { getSettings } from '../settings';
import { staffSummaries, toStaffAppointment } from '../appointments/service';
import { canBeClaimed, createInvite } from '../auth/invites';
import { localePrefix } from '../auth/routes';
import { placeholderEmail } from './appointments';
import { isPlaceholderEmail } from '../../lib/placeholder-email';

export { isPlaceholderEmail };


function toClientSummary(u: UserDoc) {
  return {
    id: u._id.toHexString(),
    name: u.name,
    surname: u.surname,
    email: isPlaceholderEmail(u.email) ? null : u.email,
    phone: u.phone,
    locale: u.locale,
    isActive: u.isActive,
    bookingBlocked: u.bookingBlocked,
    hasAccount: Boolean(u.passwordHash || u.googleId),
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

export function adminClientRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const q = parseQuery(
      c,
      z.object({
        q: z.string().trim().max(80).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
    );
    const filter: Filter<UserDoc> = { role: 'client', deletedAt: null };
    const term = q.q ? searchQuery(q.q) : '';
    if (term) filter.search = { $regex: escapeRegex(term) };

    const [docs, total] = await Promise.all([
      deps.col.users
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .toArray(),
      deps.col.users.countDocuments(filter),
    ]);

    const ids = docs.map((d) => d._id);
    const now = deps.now();
    const stats = await deps.col.appointments
      .aggregate<{ _id: ObjectId; visits: number; noShows: number; upcoming: number; lastVisit: Date | null; spent: number }>([
        { $match: { clientId: { $in: ids } } },
        {
          $group: {
            _id: '$clientId',
            visits: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            noShows: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
            upcoming: {
              $sum: { $cond: [{ $and: [{ $in: ['$status', ACTIVE_STATUSES] }, { $gt: ['$start', now] }] }, 1, 0] },
            },
            lastVisit: { $max: { $cond: [{ $eq: ['$status', 'completed'] }, '$start', null] } },
            spent: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$totalPrice', 0] } },
          },
        },
      ])
      .toArray();
    const byId = new Map(stats.map((s) => [s._id.toHexString(), s]));

    return c.json({
      total,
      page: q.page,
      pages: Math.max(1, Math.ceil(total / q.limit)),
      clients: docs.map((d) => {
        const s = byId.get(d._id.toHexString());
        return {
          ...toClientSummary(d),
          stats: {
            visits: s?.visits ?? 0,
            noShows: s?.noShows ?? 0,
            upcoming: s?.upcoming ?? 0,
            lastVisit: s?.lastVisit?.toISOString() ?? null,
            spent: s?.spent ?? 0,
          },
        };
      }),
    });
  });

  app.get('/:id', async (c) => {
    const id = paramId(c);
    const client = await deps.col.users.findOne({ _id: id, role: 'client', deletedAt: null });
    if (!client) throw notFound('Client');
    const docs = await deps.col.appointments.find({ clientId: id }).sort({ start: -1 }).limit(100).toArray();
    const [settings, staff] = await Promise.all([getSettings(deps), staffSummaries(deps, docs.map((d) => d.staffId))]);
    const now = deps.now();
    const completed = docs.filter((d) => d.status === 'completed');
    return c.json({
      client: { ...toClientSummary(client), notes: client.notes },
      stats: {
        visits: completed.length,
        noShows: docs.filter((d) => d.status === 'no_show').length,
        cancelled: docs.filter((d) => d.status === 'cancelled').length,
        spent: completed.reduce((sum, d) => sum + d.totalPrice, 0),
      },
      appointments: docs.map((d) => toStaffAppointment(d, staff, settings, now)),
    });
  });

  const createSchema = z.object({
    name: personNameSchema,
    surname: personNameSchema,
    phone: phoneSchema,
    email: emailSchema.optional(),
    notes: z.string().trim().max(2000, 'too_long').default(''),
  });

  app.post('/', async (c) => {
    const actor = c.get('user');
    const input = await parseJson(c, createSchema);
    const now = deps.now();
    const _id = new ObjectId();
    const doc: UserDoc = {
      _id,
      email: input.email ?? placeholderEmail(_id),
      name: input.name,
      surname: input.surname,
      phone: input.phone,
      role: 'client',
      locale: 'ro',
      passwordHash: null,
      googleId: null,
      isActive: true,
      bookingBlocked: false,
      tokenVersion: 0,
      notes: input.notes,
      search: userSearch(input.name, input.surname, input.email, input.phone),
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    try {
      await deps.col.users.insertOne(doc);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { email: 'taken' } });
      }
      throw error;
    }
    await audit(deps, { actorId: actor._id, action: 'client.create', targetType: 'user', targetId: _id });
    return c.json({ client: { ...toClientSummary(doc), notes: doc.notes } }, 201);
  });

  const updateSchema = z
    .object({
      name: personNameSchema,
      surname: personNameSchema,
      phone: phoneSchema.nullable(),
      email: emailSchema,
      notes: z.string().trim().max(2000, 'too_long'),
      bookingBlocked: z.boolean(),
    })
    .partial();

  app.patch('/:id', async (c) => {
    const actor = c.get('user');
    const id = paramId(c);
    const input = await parseJson(c, updateSchema);
    const client = await deps.col.users.findOne({ _id: id, role: 'client', deletedAt: null });
    if (!client) throw notFound('Client');
    if (client.isDemo === true) throw new AppError(403, 'FORBIDDEN', 'Demo accounts cannot be changed');
    // Clients with their own login manage their email themselves.
    if (input.email && input.email !== client.email && (client.passwordHash || client.googleId)) {
      throw new AppError(403, 'FORBIDDEN', 'Email of a registered client cannot be changed by staff', {
        fields: { email: 'locked' },
      });
    }
    const next = { ...client, ...input };
    try {
      await deps.col.users.updateOne(
        { _id: id },
        {
          $set: {
            ...input,
            search: userSearch(next.name, next.surname, next.email, next.phone),
            updatedAt: deps.now(),
          },
        },
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered', { fields: { email: 'taken' } });
      }
      throw error;
    }
    if (input.bookingBlocked !== undefined && input.bookingBlocked !== client.bookingBlocked) {
      await audit(deps, {
        actorId: actor._id,
        action: input.bookingBlocked ? 'client.block_booking' : 'client.unblock_booking',
        targetType: 'user',
        targetId: id,
      });
    }
    return c.json({ client: { ...toClientSummary(next), notes: next.notes } });
  });

  /**
   * A link (shown as a QR code at the desk) that lets a walk-in client create their account
   * on this same record, so the bookings staff made are already there.
   */
  app.post('/:id/invite', async (c) => {
    const actor = c.get('user');
    const id = paramId(c);
    const client = await deps.col.users.findOne({ _id: id, role: 'client', deletedAt: null });
    if (!client) throw notFound('Client');
    if (!canBeClaimed(client)) throw new AppError(409, 'ALREADY_REGISTERED', 'This client already has an account');
    const { token, expiresAt } = await createInvite(deps, client, actor._id);
    await audit(deps, { actorId: actor._id, action: 'client.invite', targetType: 'user', targetId: id });
    return c.json({ url: `${deps.config.appUrl}${localePrefix(client.locale)}/signup?invite=${token}`, expiresAt: expiresAt.toISOString() }, 201);
  });

  return app;
}
