import { Hono } from 'hono';
import type { Filter, ObjectId } from 'mongodb';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import type { UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { escapeRegex, searchQuery } from '../../lib/text';
import { paramId, parseJson, parseQuery } from '../../lib/validation';
import { revokeAllSessions } from '../auth/session';
import { isPlaceholderEmail } from './clients';

const ROLE = z.enum(['client', 'admin', 'administrator']);

function toUser(u: UserDoc) {
  return {
    id: u._id.toHexString(),
    name: u.name,
    surname: u.surname,
    email: isPlaceholderEmail(u.email) ? null : u.email,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    hasAccount: Boolean(u.passwordHash || u.googleId),
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

/** Administrator-only: roles and account status. Guards against lock-out. */
export function adminUserRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const q = parseQuery(
      c,
      z.object({
        role: ROLE.optional(),
        q: z.string().trim().max(80).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
    );
    const filter: Filter<UserDoc> = { deletedAt: null };
    if (q.role) filter.role = q.role;
    const term = q.q ? searchQuery(q.q) : '';
    if (term) filter.search = { $regex: escapeRegex(term) };
    const [docs, total] = await Promise.all([
      deps.col.users
        .find(filter)
        .sort({ role: -1, createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .toArray(),
      deps.col.users.countDocuments(filter),
    ]);
    return c.json({ users: docs.map(toUser), total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) });
  });

  app.patch('/:id', async (c) => {
    const actor = c.get('user');
    const id = paramId(c);
    const input = await parseJson(c, z.object({ role: ROLE, isActive: z.boolean() }).partial());
    if (id.equals(actor._id)) {
      throw new AppError(403, 'SELF_ACTION', 'You cannot change your own role or status');
    }
    const target = await deps.col.users.findOne({ _id: id, deletedAt: null });
    if (!target) throw notFound('User');
    // The shared demo accounts have a public password: never promoted, never switched off here
    // (DEMO_LOGIN turns them on and off).
    if (target.isDemo === true) throw new AppError(403, 'FORBIDDEN', 'Demo accounts cannot be changed');

    const losesAdministrator =
      target.role === 'administrator' &&
      target.isActive &&
      ((input.role !== undefined && input.role !== 'administrator') || input.isActive === false);
    if (losesAdministrator) {
      const others = await deps.col.users.countDocuments({
        role: 'administrator',
        isActive: true,
        deletedAt: null,
        _id: { $ne: id },
      });
      if (others === 0) throw new AppError(409, 'LAST_ADMINISTRATOR', 'At least one administrator must remain');
    }

    const changedRole = input.role !== undefined && input.role !== target.role;
    const changedStatus = input.isActive !== undefined && input.isActive !== target.isActive;
    if (!changedRole && !changedStatus) return c.json({ user: toUser(target) });

    const now = deps.now();
    const updated = await deps.col.users.findOneAndUpdate(
      { _id: id },
      { $set: { ...input, updatedAt: now }, $inc: { tokenVersion: 1 } },
      { returnDocument: 'after' },
    );
    if (!updated) throw notFound('User');
    if (input.isActive === false) await revokeAllSessions(deps, id);

    await audit(deps, {
      actorId: actor._id,
      action: changedRole ? 'user.role_change' : 'user.status_change',
      targetType: 'user',
      targetId: id,
      meta: {
        ...(changedRole ? { from: target.role, to: input.role } : {}),
        ...(changedStatus ? { isActive: input.isActive } : {}),
      },
    });
    return c.json({ user: toUser(updated) });
  });

  return app;
}

export function adminAuditRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.get('/', async (c) => {
    const q = parseQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }));
    const logs = await deps.col.auditLogs.find().sort({ at: -1 }).limit(q.limit).toArray();
    const actorIds = new Map<string, ObjectId>();
    for (const log of logs) if (log.actorId) actorIds.set(log.actorId.toHexString(), log.actorId);
    const actors = await deps.col.users
      .find({ _id: { $in: [...actorIds.values()] } }, { projection: { name: 1, surname: 1, role: 1 } })
      .toArray();
    const byId = new Map(actors.map((a) => [a._id.toHexString(), a]));
    return c.json({
      logs: logs.map((l) => {
        const actor = l.actorId ? byId.get(l.actorId.toHexString()) : undefined;
        return {
          id: l._id.toHexString(),
          at: l.at.toISOString(),
          action: l.action,
          targetType: l.targetType,
          targetId: l.targetId,
          meta: l.meta,
          actor: actor ? { name: actor.name, surname: actor.surname, role: actor.role } : null,
        };
      }),
    });
  });
  return app;
}
