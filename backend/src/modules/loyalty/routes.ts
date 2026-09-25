import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES, type UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { isPlaceholderEmail } from '../../lib/placeholder-email';
import { paramId, parseJson } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { staffSummaries, toStaffAppointment } from '../appointments/service';
import { getSettings } from '../settings';
import { cardUrl, ensureMemberCode, loyaltyStatus, loyaltyTags, normalizeMemberCode } from './service';

/** /api/loyalty — the signed-in client's own card: member code (shown as a QR) and stamps. */
export function loyaltyRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/', async (c) => {
    const user = c.get('user');
    const [settings, code] = await Promise.all([getSettings(deps), ensureMemberCode(deps, user)]);
    const loyalty = await loyaltyStatus(deps, user, settings);
    c.header('Cache-Control', 'private, no-store');
    return c.json({ card: { code, url: cardUrl(deps.config.appUrl, code) }, loyalty });
  });

  return app;
}

/**
 * /api/admin/loyalty — staff: open a client's card from a scanned QR code (or a typed code),
 * see the stamps and the visits to come with their discounts, add or remove a stamp by hand.
 */
export function adminLoyaltyRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  async function cardFor(client: UserDoc) {
    const now = deps.now();
    const [settings, code] = await Promise.all([getSettings(deps), ensureMemberCode(deps, client)]);
    const [loyalty, upcoming] = await Promise.all([
      loyaltyStatus(deps, client, settings),
      deps.col.appointments
        .find({ clientId: client._id, status: { $in: ACTIVE_STATUSES } })
        .sort({ start: 1 })
        .limit(5)
        .toArray(),
    ]);
    const [staff, tags] = await Promise.all([
      staffSummaries(deps, upcoming.map((a) => a.staffId)),
      loyaltyTags(deps, upcoming, settings),
    ]);
    return {
      client: {
        id: client._id.toHexString(),
        name: client.name,
        surname: client.surname,
        phone: client.phone,
        email: isPlaceholderEmail(client.email) ? null : client.email,
        hasAccount: Boolean(client.passwordHash || client.googleId),
        memberCode: code,
      },
      loyalty,
      appointments: upcoming.map((a) => ({
        ...toStaffAppointment(a, staff, settings, now),
        loyalty: tags.get(a._id.toHexString()) ?? null,
      })),
    };
  }

  async function findClient(filter: Partial<Pick<UserDoc, '_id' | 'memberCode'>>) {
    const client = await deps.col.users.findOne({ ...filter, deletedAt: null });
    if (!client) throw new AppError(404, 'CARD_NOT_FOUND', 'No client with this card');
    return client;
  }

  app.get('/card/:code', async (c) => {
    const code = normalizeMemberCode(decodeURIComponent(c.req.param('code')));
    if (!code) throw new AppError(404, 'CARD_NOT_FOUND', 'Not a member code');
    return c.json(await cardFor(await findClient({ memberCode: code })));
  });

  app.get('/clients/:id', async (c) => {
    const client = await deps.col.users.findOne({ _id: paramId(c), deletedAt: null });
    if (!client) throw notFound('Client');
    return c.json(await cardFor(client));
  });

  app.post('/clients/:id/stamps', async (c) => {
    const id = paramId(c);
    const input = await parseJson(
      c,
      z.object({ delta: z.union([z.literal(1), z.literal(-1)]), reason: z.string().trim().max(200, 'too_long').default('') }),
    );
    const client = await deps.col.users.findOne({ _id: id, deletedAt: null });
    if (!client) throw notFound('Client');
    const settings = await getSettings(deps);
    const current = await loyaltyStatus(deps, client, settings);
    // A card can't go below zero stamps.
    if (input.delta < 0 && current.visits === 0) throw new AppError(409, 'CONFLICT', 'The card has no stamps');
    const updated = await deps.col.users.findOneAndUpdate(
      { _id: id },
      { $inc: { loyaltyBonus: input.delta }, $set: { updatedAt: deps.now() } },
      { returnDocument: 'after' },
    );
    await audit(deps, {
      actorId: c.get('user')._id,
      action: 'loyalty.stamp',
      targetType: 'user',
      targetId: id,
      meta: { delta: input.delta, reason: input.reason, visits: current.visits + input.delta },
    });
    return c.json(await cardFor(updated!));
  });

  return app;
}
