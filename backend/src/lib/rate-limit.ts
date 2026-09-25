import type { AppDeps } from '../context';
import { AppError } from './errors';

/**
 * Fixed-window rate limiter stored in MongoDB (works identically on Node and Workers).
 * One atomic upsert per hit; a TTL index removes expired windows.
 */
export async function hitRateLimit(
  deps: AppDeps,
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (!deps.config.rateLimits) return { allowed: true, retryAfterSec: 0 };

  const now = deps.now();
  const windowEnd = new Date(now.getTime() + windowSec * 1000);
  const doc = await deps.col.rateLimits.findOneAndUpdate(
    { _id: key },
    [
      {
        $set: {
          count: { $cond: [{ $gt: ['$expiresAt', now] }, { $add: ['$count', 1] }, 1] },
          expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', windowEnd] },
        },
      },
    ],
    { upsert: true, returnDocument: 'after' },
  );

  const count = doc?.count ?? 1;
  const expiresAt = doc?.expiresAt ?? windowEnd;
  return {
    allowed: count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Throws 429 with Retry-After when any of the given buckets is exhausted. */
export async function enforceRateLimits(
  deps: AppDeps,
  buckets: Array<{ key: string; limit: number; windowSec: number }>,
): Promise<void> {
  const results = await Promise.all(
    buckets.map((b) => hitRateLimit(deps, b.key, b.limit, b.windowSec)),
  );
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length > 0) {
    const retryAfter = Math.max(...blocked.map((r) => r.retryAfterSec));
    throw new AppError(429, 'RATE_LIMITED', 'Too many requests', {
      headers: { 'Retry-After': String(retryAfter) },
    });
  }
}
