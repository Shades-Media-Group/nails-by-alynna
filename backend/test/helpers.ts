import { inject } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Database, migrateNotifications } from '../src/db';
import type { MailMessage } from '../src/lib/mailer';
import { createDatabase, createDeps, migrate } from '../src/runtime';
import { runSeed } from '../src/seed/run';

export const APP_ORIGIN = 'http://localhost:5180';

export async function createTestContext(env: Record<string, string> = {}) {
  // Every context gets its own schema in the test database, dropped on close.
  const schema = `nba_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const config = loadConfig({
    APP_ENV: 'test',
    APP_URL: APP_ORIGIN,
    DATABASE_URL: inject('databaseUrl'),
    JWT_SECRET: 'test-secret-'.padEnd(48, 'x'),
    PASSWORD_HASH_COST: 'fast',
    RATE_LIMITS: 'off',
    ...env,
  });
  const db = createDatabase(config, { poolSize: 5, schema });
  let now = new Date('2026-06-01T06:00:00Z'); // Monday 09:00 in Chișinău (EEST)
  const deferred: Promise<unknown>[] = [];
  const sentMail: MailMessage[] = [];
  const deps = createDeps(config, db, {
    clientIp: (c) => c.req.header('x-test-ip') ?? '203.0.113.7',
    defer: (task) => {
      deferred.push(task);
    },
    now: () => now,
  });
  deps.mailer = {
    enabled: true,
    async send(message) {
      sentMail.push(message);
    },
  };
  await migrate(deps);
  await migrateNotifications(deps.db, now);
  const app = createApp(deps);

  return {
    app,
    deps,
    config,
    sentMail,
    now: () => now,
    setNow(date: Date) {
      now = date;
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    /** Waits for work done after responses, including work that deferred more work. */
    async flush() {
      while (deferred.length > 0) await Promise.all(deferred.splice(0));
    },
    client: (opts?: ClientOptions) => new TestClient(app, opts),
    seed: (options?: Parameters<typeof runSeed>[1]) => runSeed(deps, options),
    async close() {
      await db.drop();
      await db.close();
    },
  };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

/** A bare database handle in a schema of its own (adapter tests); `drop()` then `close()` it. */
export function createTestDatabase(poolSize = 10): Database {
  const schema = `nba_pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Database({ url: inject('databaseUrl'), poolSize, schema });
}

interface ClientOptions {
  origin?: string | null;
  ip?: string;
}

export interface TestResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
  setCookies: string[];
}

/** Minimal browser: keeps cookies between requests and sends same-origin fetch metadata. */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
    private readonly opts: ClientOptions = {},
  ) {}

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse<T>> {
    const h = new Headers(headers);
    const origin = this.opts.origin === undefined ? APP_ORIGIN : this.opts.origin;
    if (origin && !h.has('origin')) h.set('origin', origin);
    if (!h.has('sec-fetch-site')) h.set('sec-fetch-site', 'same-origin');
    if (this.opts.ip) h.set('x-test-ip', this.opts.ip);
    if (body !== undefined && !h.has('content-type')) h.set('content-type', 'application/json');
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.set('cookie', cookie);

    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    // Like a real HTTP client: the server decides "has a body" from the headers.
    if (payload !== undefined && !h.has('content-length')) h.set('content-length', String(new TextEncoder().encode(payload).length));
    const res = await this.app.request(path, { method, headers: h, body: payload });
    const setCookies = res.headers.getSetCookie();
    for (const line of setCookies) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const expired = /max-age=0/i.test(line) || value === '';
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, body: parseBody(text) as T, headers: res.headers, setCookies };
  }

  /** The cookies this client holds, as a Cookie header. */
  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get<T = any>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('POST', path, body, headers);
  }
  patch<T = any>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T = any>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, body);
  }
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const strongPassword = 'Velvet-Nails-2026!';

export async function registerClient(
  ctx: TestContext,
  overrides: Partial<{ email: string; name: string; surname: string; phone: string; password: string; remember: boolean }> = {},
) {
  const client = ctx.client();
  const res = await client.post('/api/auth/register', {
    name: 'Ana',
    surname: 'Rusu',
    email: `ana.${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: '069 123 456',
    password: strongPassword,
    locale: 'ro',
    acceptTerms: true,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  // Sign-up only sends a code; entering it proves the email and signs in.
  const email = res.body.verification.email as string;
  const verified = await client.post('/api/auth/verify-email', {
    email,
    code: await latestCode(ctx, email),
    remember: overrides.remember ?? true,
  });
  if (verified.status !== 200) throw new Error(`verify failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  return { client, user: verified.body.user as { id: string; email: string } };
}

/** The 6-digit code of the newest email sent to `email` (codes go out after the response). */
export async function latestCode(ctx: TestContext, email: string): Promise<string> {
  await ctx.flush();
  const mail = [...ctx.sentMail].reverse().find((m) => m.to === email.toLowerCase());
  const code = mail ? /(\d{6})\s*$/.exec(mail.subject)?.[1] : undefined;
  if (!code) throw new Error(`no code was emailed to ${email}`);
  return code;
}

export async function loginAs(ctx: TestContext, email: string, password: string) {
  const client = ctx.client();
  const res = await client.post('/api/auth/login', { email, password, remember: true });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return client;
}
