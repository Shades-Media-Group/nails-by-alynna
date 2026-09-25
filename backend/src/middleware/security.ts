import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { AppDeps, AppEnv } from '../context';
import { AppError } from '../lib/errors';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Request id + resolved client IP, available to every handler. */
export function requestContext(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.set('ip', deps.clientIp(c));
    await next();
    c.header('X-Request-Id', requestId);
  });
}

/** Strict headers for JSON API responses: no caching, no framing, no sniffing. */
export function apiSecurityHeaders(deps: AppDeps) {
  return secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    crossOriginResourcePolicy: 'same-origin',
    crossOriginOpenerPolicy: 'same-origin',
    referrerPolicy: 'no-referrer',
    strictTransportSecurity: deps.config.isProd ? 'max-age=63072000; includeSubDomains; preload' : false,
    xFrameOptions: 'DENY',
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
  });
}

/** API responses are private and uncacheable unless a route opts into caching explicitly. */
export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
});

/**
 * CSRF defence in depth for state-changing requests. Cookies are SameSite=Strict, and on
 * top of that we require: a same-origin fetch (Fetch Metadata), an allowed Origin, and a
 * JSON body (which cross-site forms cannot send without a CORS preflight).
 */
export function originGuard(deps: AppDeps) {
  const allowed = new Set(deps.config.allowedOrigins);
  return createMiddleware<AppEnv>(async (c, next) => {
    if (UNSAFE_METHODS.has(c.req.method)) {
      const site = c.req.header('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'none') {
        throw new AppError(403, 'CSRF_REJECTED', 'Cross-site request rejected');
      }
      const origin = c.req.header('origin');
      if (origin && !allowed.has(origin)) {
        throw new AppError(403, 'CSRF_REJECTED', 'Origin not allowed');
      }
      const hasBody = c.req.raw.body !== null;
      const type = (c.req.header('content-type') ?? '').toLowerCase();
      if (hasBody && !type.startsWith('application/json')) {
        throw new AppError(415, 'BAD_REQUEST', 'Content-Type must be application/json');
      }
    }
    await next();
  });
}

export const jsonBodyLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: () => {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  },
});
