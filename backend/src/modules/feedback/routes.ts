import { ObjectId } from 'bson';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { FEEDBACK_RATINGS, type FeedbackDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { enforceRateLimits } from '../../lib/rate-limit';
import { objectIdSchema, parseJson, parseQuery } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { feedbackOpen, feedbackScope, pendingVisit, summarize, toClientFeedback } from './service';

const COMMENT_MAX = 1000;
/** General feedback is a message, so it needs a few words; a visit can get stars alone. */
const GENERAL_MIN = 3;
const PAGE_SIZE = 20;

const ratingSchema = z.literal(FEEDBACK_RATINGS, 'invalid');

const feedbackSchema = z.object({
  appointmentId: objectIdSchema.optional(),
  rating: ratingSchema.nullable().optional(),
  comment: z.string('invalid').trim().max(COMMENT_MAX, 'too_long').default(''),
});

const uniqueIds = (ids: ObjectId[]) => [...new Map(ids.map((id) => [id.toHexString(), id])).values()];

/**
 * /api/feedback — the signed-in client tells the studio how a visit went (stars and a comment,
 * after it is completed) or what they think in general. The card on Home asks about the latest
 * visit until it is rated or closed.
 */
export function feedbackRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/pending', async (c) => {
    const visit = await pendingVisit(deps, c.get('user')._id, deps.now());
    if (!visit) return c.json({ visit: null });
    const master = await deps.col.staff.findOne({ _id: visit.staffId }, { projection: { name: 1 } });
    return c.json({
      visit: {
        id: visit._id.toHexString(),
        start: visit.start.toISOString(),
        end: visit.end.toISOString(),
        services: visit.services.map((s) => s.name),
        master: master?.name ?? null,
      },
    });
  });

  /**
   * With `appointmentId`: feedback on that completed visit (stars required); sending it again
   * within two weeks changes it. Without: general feedback (a comment required, stars optional).
   */
  app.post('/', async (c) => {
    const user = c.get('user');
    // Enough for a change of mind; not enough for a script to fill the owner's list.
    await enforceRateLimits(deps, [{ key: `feedback:user:${user._id.toHexString()}`, limit: 10, windowSec: 3600 }]);
    const input = await parseJson(c, feedbackSchema);
    const rating = input.rating ?? null;
    const now = deps.now();

    if (!input.appointmentId) {
      if (input.comment.length < GENERAL_MIN) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Write a few words', { fields: { comment: input.comment ? 'too_short' : 'required' } });
      }
      const doc: FeedbackDoc = {
        _id: new ObjectId(),
        userId: user._id,
        kind: 'general',
        appointmentId: null,
        staffId: null,
        rating,
        comment: input.comment,
        locale: user.locale,
        createdAt: now,
        updatedAt: now,
      };
      await deps.col.feedback.insertOne(doc);
      await audit(deps, { actorId: user._id, action: 'feedback.create', targetType: 'feedback', targetId: doc._id, meta: { kind: 'general', rating } });
      return c.json({ feedback: toClientFeedback(doc) }, 201);
    }

    if (rating === null) throw new AppError(422, 'VALIDATION_ERROR', 'A visit is rated with stars', { fields: { rating: 'required' } });
    const visit = await deps.col.appointments.findOne({ _id: input.appointmentId, clientId: user._id });
    if (!visit) throw notFound('Appointment');
    if (visit.status !== 'completed') throw new AppError(409, 'INVALID_STATUS', 'Only a completed visit can be rated');
    if (!feedbackOpen(visit, now)) throw new AppError(409, 'FEEDBACK_CLOSED', 'Feedback on this visit is closed');

    const before = await deps.col.feedback.findOne({ appointmentId: visit._id }, { projection: { rating: 1 } });
    // One document per visit (unique index): a second send, even from another phone at the same
    // moment, changes the first.
    const saved = await deps.col.feedback.findOneAndUpdate(
      { appointmentId: visit._id },
      {
        $set: { staffId: visit.staffId, rating, comment: input.comment, locale: user.locale, updatedAt: now },
        $setOnInsert: { userId: user._id, kind: 'visit' as const, createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
    await audit(deps, {
      actorId: user._id,
      action: before ? 'feedback.update' : 'feedback.create',
      targetType: 'feedback',
      targetId: saved!._id,
      meta: { kind: 'visit', rating, appointmentId: visit._id.toHexString(), ...(before ? { previousRating: before.rating } : {}) },
    });
    return c.json({ feedback: toClientFeedback(saved!) }, before ? 200 : 201);
  });

  /** "Not now" on the Home card: that visit is not asked about in the app again. */
  app.post('/dismiss', async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `feedback:dismiss:user:${user._id.toHexString()}`, limit: 30, windowSec: 3600 }]);
    const input = await parseJson(c, z.object({ appointmentId: objectIdSchema }));
    const result = await deps.col.appointments.updateOne(
      { _id: input.appointmentId, clientId: user._id },
      { $set: { feedbackDismissedAt: deps.now() } },
    );
    if (result.matchedCount === 0) throw notFound('Appointment');
    return c.json({ ok: true });
  });

  return app;
}

/**
 * /api/admin/feedback — what clients said, newest first, 20 a page, optionally only one rating,
 * with the average on top. The owner reads everything; a master only feedback on their own
 * visits; staff without a master profile get an empty list.
 */
export function adminFeedbackRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const q = parseQuery(
      c,
      z.object({
        page: z.coerce.number().int().min(1).max(1000).default(1),
        rating: z.coerce.number().pipe(ratingSchema).optional(),
      }),
    );
    const { scope, filter } = await feedbackScope(deps, c.get('user'));
    if (!filter) return c.json({ feedback: [], summary: summarize([], 0), total: 0, page: 1, pages: 1, scope });

    const listed = q.rating ? { ...filter, rating: q.rating } : filter;
    const [docs, total, all, counts] = await Promise.all([
      deps.col.feedback
        .find(listed)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray(),
      deps.col.feedback.countDocuments(listed),
      q.rating ? deps.col.feedback.countDocuments(filter) : null,
      deps.col.feedback
        .aggregate<{ _id: unknown; count: number }>([
          { $match: { ...filter, rating: { $in: [...FEEDBACK_RATINGS] } } },
          { $group: { _id: '$rating', count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const [clients, visits, masters] = await Promise.all([
      deps.col.users.find({ _id: { $in: uniqueIds(docs.map((d) => d.userId)) } }, { projection: { name: 1, surname: 1 } }).toArray(),
      deps.col.appointments
        .find({ _id: { $in: docs.flatMap((d) => (d.appointmentId ? [d.appointmentId] : [])) } }, { projection: { code: 1, start: 1, services: 1 } })
        .toArray(),
      deps.col.staff.find({ _id: { $in: uniqueIds(docs.flatMap((d) => (d.staffId ? [d.staffId] : []))) } }, { projection: { name: 1 } }).toArray(),
    ]);
    const clientById = new Map(clients.map((u) => [u._id.toHexString(), u]));
    const visitById = new Map(visits.map((a) => [a._id.toHexString(), a]));
    const masterById = new Map(masters.map((s) => [s._id.toHexString(), s]));

    return c.json({
      feedback: docs.map((f) => {
        const client = clientById.get(f.userId.toHexString());
        const visit = f.appointmentId ? visitById.get(f.appointmentId.toHexString()) : undefined;
        const master = f.staffId ? masterById.get(f.staffId.toHexString()) : undefined;
        return {
          id: f._id.toHexString(),
          kind: f.kind,
          rating: f.rating,
          comment: f.comment,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
          client: client ? { id: client._id.toHexString(), name: client.name, surname: client.surname } : null,
          visit: visit
            ? { id: visit._id.toHexString(), code: visit.code, start: visit.start.toISOString(), services: visit.services.map((s) => s.name) }
            : null,
          master: master ? { id: master._id.toHexString(), name: master.name } : null,
        };
      }),
      summary: summarize(counts, all ?? total),
      total,
      page: q.page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      scope,
    });
  });

  return app;
}
