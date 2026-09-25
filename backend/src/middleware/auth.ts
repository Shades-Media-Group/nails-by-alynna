import { ObjectId } from 'mongodb';
import { createMiddleware } from 'hono/factory';
import type { Role } from '../config';
import type { AppDeps, AppEnv } from '../context';
import { AppError } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';
import { readAccessToken } from '../modules/auth/cookies';

/**
 * Verifies the access JWT and loads the user on every request, so deactivation, role
 * changes and "sign out everywhere" (token version bump) take effect immediately.
 */
export function requireAuth(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = readAccessToken(c, deps.config);
    if (!token) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');

    const claims = await verifyAccessToken(deps.config, token, deps.now());
    if (!claims || !ObjectId.isValid(claims.sub)) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Access token expired or invalid');
    }

    const user = await deps.col.users.findOne({ _id: new ObjectId(claims.sub) });
    if (!user || !user.isActive || user.deletedAt || user.tokenVersion !== claims.tv) {
      throw new AppError(401, 'SESSION_REVOKED', 'Session is no longer valid');
    }

    c.set('user', user);
    c.set('sessionId', claims.sid);
    await next();
  });
}

export function requireRole(...roles: Role[]) {
  const allowed = new Set(roles);
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user || !allowed.has(user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Insufficient permissions');
    }
    await next();
  });
}

export const STAFF_ROLES: Role[] = ['admin', 'administrator'];
