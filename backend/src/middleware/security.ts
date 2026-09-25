import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { AppDeps, AppEnv } from '../context';
import { timingSafeEqualStr } from '../lib/crypto';
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

/**
 * When the API runs behind the Cloudflare Worker (host.md deployment) every legitimate request
 * carries the shared proxy key. Anything else gets a bare 404, so the backend host reveals
 * nothing about the app and cannot be used to bypass the Worker.
 */
export function proxyGuard(deps: AppDeps) {
  const secret = deps.config.proxySecret;
  return createMiddleware<AppEnv>(async (c, next) => {
    if (secret) {
      const key = c.req.header('x-nba-proxy-key') ?? '';
      if (!timingSafeEqualStr(key, secret)) return c.text('Not Found', 404);
    }
    await next();
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
  const isAllowed = (origin: string) => allowed.has(origin) || (deps.config.env === 'development' && isLanDevOrigin(origin, deps.config.appUrl));
  return createMiddleware<AppEnv>(async (c, next) => {
    if (UNSAFE_METHODS.has(c.req.method)) {
      const site = c.req.header('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'none') {
        throw new AppError(403, 'CSRF_REJECTED', 'Cross-site request rejected');
      }
      const origin = c.req.header('origin');
      if (origin && !isAllowed(origin)) {
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

/**
 * Development only: the dev server opened from a phone on the same network
 * (`yarn dev:lan`, e.g. http://192.168.1.20:5180) — a private address on the dev server's port.
 */
export function isLanDevOrigin(origin: string, appUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const port = new URL(appUrl).port;
  const privateHost = /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
  return url.protocol === 'http:' && url.port === port && privateHost.test(url.hostname);
}

export const jsonBodyLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: () => {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  },
});
