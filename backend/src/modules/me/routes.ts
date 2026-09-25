import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { enforceRateLimits } from '../../lib/rate-limit';
import { userSearch } from '../../lib/text';
import {
  localeSchema,
  parseJson,
  passwordSchema,
  personNameSchema,
  phoneSchema,
} from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { clearSessionCookies } from '../auth/cookies';
import { revokeAllSessions, toPublicUser } from '../auth/session';

export function meRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  const updateSchema = z
    .object({
      name: personNameSchema,
      surname: personNameSchema,
      phone: phoneSchema,
      locale: localeSchema,
    })
    .partial();

  app.patch('/', async (c) => {
    const user = c.get('user');
    const input = await parseJson(c, updateSchema);
    const next = { ...user, ...input };
    const now = deps.now();
    const set = {
      ...input,
      search: userSearch(next.name, next.surname, next.email, next.phone),
      updatedAt: now,
    };
    await deps.col.users.updateOne({ _id: user._id }, { $set: set });
    return c.json({ user: toPublicUser({ ...next, updatedAt: now }) });
  });

  const passwordChangeSchema = z.object({
    currentPassword: z.string().max(128).optional(),
    newPassword: passwordSchema,
  });

  app.post('/password', async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `pwchange:user:${user._id.toHexString()}`, limit: 10, windowSec: 900 }]);
    const input = await parseJson(c, passwordChangeSchema);
    if (user.passwordHash) {
      const check = await deps.passwords.verify(input.currentPassword ?? '', user.passwordHash);
      if (!check.ok) {
        throw new AppError(422, 'WRONG_PASSWORD', 'Current password is incorrect', {
          fields: { currentPassword: 'wrong' },
        });
      }
    }
    const now = deps.now();
    await deps.col.users.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await deps.passwords.hash(input.newPassword), updatedAt: now } },
    );
    // Other devices must sign in again; this device keeps working after a refresh.
    const current = c.get('sessionId');
    await deps.col.sessions.updateMany(
      { userId: user._id, revokedAt: null, ...(ObjectId.isValid(current) ? { _id: { $ne: new ObjectId(current) } } : {}) },
      { $set: { revokedAt: now } },
    );
    await audit(deps, { actorId: user._id, action: 'user.password_change', targetType: 'user', targetId: user._id });
    return c.json({ ok: true });
  });

  /**
   * Account deletion keeps visit history for the studio's records but removes personal
   * data: contact details are anonymised and upcoming appointments are cancelled.
   */
  app.delete('/', async (c) => {
    const user = c.get('user');
    const input = await parseJson(c, z.object({ password: z.string().max(128).optional() }));
    if (user.role !== 'client') {
      throw new AppError(403, 'FORBIDDEN', 'Staff accounts are removed by an administrator');
    }
    if (user.passwordHash) {
      const check = await deps.passwords.verify(input.password ?? '', user.passwordHash);
      if (!check.ok) {
        throw new AppError(422, 'WRONG_PASSWORD', 'Password is incorrect', { fields: { password: 'wrong' } });
      }
    }
    const now = deps.now();
    const anonymousEmail = `deleted+${user._id.toHexString()}@invalid.local`;
    await deps.col.appointments.updateMany(
      { clientId: user._id, status: { $in: ACTIVE_STATUSES }, start: { $gt: now } },
      { $set: { status: 'cancelled', cancelledAt: now, cancelledBy: 'client', cancelReason: 'account_deleted', updatedAt: now } },
    );
    await deps.col.appointments.updateMany(
      { clientId: user._id },
      { $set: { client: { name: 'Deleted', surname: 'client', phone: null, email: anonymousEmail } } },
    );
    await deps.col.users.updateOne(
      { _id: user._id },
      {
        $set: {
          email: anonymousEmail,
          name: 'Deleted',
          surname: 'client',
          phone: null,
          passwordHash: null,
          googleId: null,
          isActive: false,
          notes: '',
          search: '',
          deletedAt: now,
          updatedAt: now,
        },
      },
    );
    await revokeAllSessions(deps, user._id);
    clearSessionCookies(c, deps.config);
    await audit(deps, { actorId: user._id, action: 'user.delete_self', targetType: 'user', targetId: user._id });
    return c.json({ ok: true });
  });

  return app;
}
