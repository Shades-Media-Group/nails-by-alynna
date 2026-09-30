/**
 * Post-deploy verification: `yarn deploy:verify [url] [--version <v>]`
 *
 * Checks the live app (frontend Worker + API through the service binding): health, database,
 * security headers, SPA routing, PWA files and — when given — that the expected build
 * version is being served. Exits non-zero on any failure.
 */
export {}; // an ES module (top-level await)

const args = process.argv.slice(2);
const versionFlag = args.indexOf('--version');
const expectedVersion = versionFlag >= 0 ? args[versionFlag + 1] : process.env.EXPECTED_VERSION;
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--version');

const base = (positional[0] ?? process.env.DEPLOY_URL ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base) || base.includes('example.')) {
  console.error('Usage: yarn deploy:verify https://your-app.example [--version <build-version>]');
  console.error('(or set DEPLOY_URL)');
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

interface Health {
  status?: string;
  version?: string;
  checks?: {
    database?: {
      status?: string;
      latencyMs?: number;
      schema?: { version: number | null; notifications: number | null; current: boolean } | null;
    };
  };
}

/**
 * /api/health once the API has settled: it restarts on the first request after an upload and
 * migrates the database in the background just after, so this asks again for up to 90 s until
 * it is this build with its tables in place.
 */
async function settledHealth(): Promise<{ status: number; body: Health }> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    let status = 0;
    let body: Health = {};
    try {
      const res = await fetch(`${base}/api/health?t=${Date.now()}`);
      status = res.status;
      body = (await res.json()) as Health;
    } catch {
      // Not answering yet (restarting); asked again below.
    }
    const settled = status === 200 && (!expectedVersion || body.version === expectedVersion) && body.checks?.database?.schema?.current === true;
    if (settled || Date.now() > deadline) return { status, body };
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

const health = await settledHealth();

await check('API health and database', async () => {
  const { status, body } = health;
  const db = body.checks?.database;
  assert(status === 200 && body.status === 'ok' && db?.status === 'ok', `status ${status}, body ${JSON.stringify(body).slice(0, 240)}`);
  return `api ${body.version}, database ${db?.latencyMs} ms`;
});

if (expectedVersion) {
  await check('API runs this build', async () => {
    const { version } = health.body;
    assert(version === expectedVersion, `serving ${version}, expected ${expectedVersion} (did the app restart?)`);
  });
}

await check("Database migrated to this build's schema", async () => {
  const schema = health.body.checks?.database?.schema;
  assert(schema, 'the API does not report its schema (an older build?)');
  assert(schema.current, `schema v${schema.version}, notifications v${schema.notifications}: not migrated (see "database not ready" in the app log)`);
  return `schema v${schema.version}, notifications v${schema.notifications}`;
});

await check('Combined /health for uptime monitors', async () => {
  const res = await fetch(`${base}/health`);
  const body = (await res.json()) as { status?: string };
  assert(res.status === 200 && body.status === 'ok', `status ${res.status}, ${JSON.stringify(body).slice(0, 160)}`);
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
