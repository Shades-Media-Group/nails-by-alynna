/**
 * Post-deploy verification: `yarn deploy:verify [url] [--version <v>]`
 *
 * Checks the live app (frontend Worker + API through the service binding): health, database,
 * security headers, SPA routing, PWA files and — when given — that the expected build
 * version is being served. Exits non-zero on any failure.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const versionFlag = args.indexOf('--version');
const expectedVersion = versionFlag >= 0 ? args[versionFlag + 1] : process.env.EXPECTED_VERSION;
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--version');

function appUrlFromWrangler(): string | undefined {
  try {
    const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    return /"APP_URL"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
  } catch {
    return undefined;
  }
}

const base = (positional[0] ?? process.env.DEPLOY_URL ?? appUrlFromWrangler() ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base) || base.includes('example.')) {
  console.error('Usage: yarn deploy:verify https://your-app.example [--version <build-version>]');
  console.error('(or set DEPLOY_URL, or set a real APP_URL in backend/wrangler.jsonc)');
  process.exit(2);
}

let failures = 0;
async function check(name: string, run: () => Promise<string | void>) {
  try {
    const detail = await run();
    console.info(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL  ${name} — ${(error as Error).message}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.info(`Verifying ${base}${expectedVersion ? ` (expecting version ${expectedVersion})` : ''}`);

await check('API health and database', async () => {
  const res = await fetch(`${base}/api/health`);
  const body = (await res.json()) as { status?: string; db?: string };
  assert(res.status === 200 && body.db === 'ok', `status ${res.status}, body ${JSON.stringify(body)}`);
  return `db ${body.db}`;
});

await check('API security headers', async () => {
  const res = await fetch(`${base}/api/config`);
  assert(res.ok, `status ${res.status}`);
  const h = res.headers;
  assert(h.get('x-content-type-options') === 'nosniff', 'missing nosniff');
  assert(h.get('x-frame-options') === 'DENY', 'missing X-Frame-Options');
  assert((h.get('strict-transport-security') ?? '').includes('max-age'), 'missing HSTS');
});

await check('Protected endpoints require auth', async () => {
  const res = await fetch(`${base}/api/auth/me`);
  assert(res.status === 401, `expected 401, got ${res.status}`);
});

await check('Cross-site writes are rejected', async () => {
  const res = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

await check('SPA routes serve the app shell', async () => {
  for (const path of ['/', '/login', '/ru/login', '/en/app', '/admin']) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    assert(res.status === 200, `${path} → ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('text/html'), `${path} is not HTML`);
  }
  const res = await fetch(`${base}/login`);
  assert((res.headers.get('content-security-policy') ?? '').includes("default-src 'self'"), 'missing CSP on HTML');
});

await check('PWA manifest and service worker', async () => {
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert(manifest.ok, `manifest ${manifest.status}`);
  const json = (await manifest.json()) as { name?: string; icons?: unknown[] };
  assert(json.name && (json.icons?.length ?? 0) >= 3, 'manifest incomplete');
  const sw = await fetch(`${base}/sw.js`);
  assert(sw.ok, `sw.js ${sw.status}`);
  assert((sw.headers.get('cache-control') ?? '').includes('no-cache'), 'sw.js must not be cached');
});

await check('Build version', async () => {
  const res = await fetch(`${base}/version.json?t=${Date.now()}`);
  assert(res.ok, `version.json ${res.status}`);
  const body = (await res.json()) as { version?: string };
  if (expectedVersion) assert(body.version === expectedVersion, `serving ${body.version}, expected ${expectedVersion}`);
  return body.version;
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.info('\nAll deploy checks passed.');
