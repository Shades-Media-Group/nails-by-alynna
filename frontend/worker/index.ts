/**
 * Nails by Alynna — Cloudflare Worker in front of the app.
 *
 * - Static files (the React PWA) are served by Workers Static Assets; this script only runs
 *   for /api/* (see `run_worker_first` in wrangler.jsonc).
 * - /api/* is reverse-proxied to the backend so the browser only ever sees this origin:
 *   no backend URL in the client, first-party cookies, no CORS.
 * - The backend is reached either through a service binding (API on Workers) or over HTTPS
 *   (API_ORIGIN, e.g. the Node.js app on host.md). Every proxied request carries a shared
 *   secret so the backend can refuse traffic that did not come through this Worker.
 */

interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  /** Optional service binding to the API Worker (backend/wrangler.jsonc). */
  API?: Fetcher;
  /** HTTPS origin of the backend when it runs outside Cloudflare, e.g. https://api.example.md */
  API_ORIGIN?: string;
  /** Shared secret expected by the backend (PROXY_SECRET there). Set with `wrangler secret put`. */
  PROXY_SECRET?: string;
}

/** Headers that would reveal the backend's software or location. */
const HIDDEN_RESPONSE_HEADERS = [
  'server',
  'x-powered-by',
  'x-runtime',
  'via',
  'x-served-by',
  'x-backend',
  'x-upstream',
  'x-litespeed-cache',
  'x-turbo-charged-by',
  'x-aspnet-version',
  'x-generator',
];

/** Hop-by-hop and client-supplied headers never forwarded upstream. */
const STRIPPED_REQUEST_HEADERS = ['x-nba-proxy-key', 'x-nba-client-ip', 'x-forwarded-for', 'x-real-ip', 'forwarded'];

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name);

  const clientIp = request.headers.get('cf-connecting-ip') ?? '';
  if (clientIp) headers.set('x-nba-client-ip', clientIp);
  if (env.PROXY_SECRET) headers.set('x-nba-proxy-key', env.PROXY_SECRET);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  let upstream: Response;
  try {
    if (env.API_ORIGIN) {
      const target = new URL(url.pathname + url.search, env.API_ORIGIN);
      upstream = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
      });
    } else if (env.API) {
      upstream = await env.API.fetch(new Request(request, { headers, redirect: 'manual' }));
    } else {
      return jsonError(503, 'API_NOT_CONFIGURED', 'API is not configured');
    }
  } catch {
    return jsonError(502, 'UPSTREAM_UNAVAILABLE', 'The service is temporarily unavailable');
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of HIDDEN_RESPONSE_HEADERS) responseHeaders.delete(name);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return proxyApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
