import { inject } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { MailMessage } from '../src/lib/mailer';
import { createDeps, createMongo, migrate } from '../src/runtime';
import { runSeed } from '../src/seed/run';

export const APP_ORIGIN = 'http://localhost:5173';

export async function createTestContext(env: Record<string, string> = {}) {
  const dbName = `nba_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const config = loadConfig({
    APP_ENV: 'test',
    APP_URL: APP_ORIGIN,
    MONGODB_URI: inject('mongoUri'),
    MONGODB_DB: dbName,
    JWT_SECRET: 'test-secret-'.padEnd(48, 'x'),
    PASSWORD_HASH_COST: 'fast',
    RATE_LIMITS: 'off',
    ...env,
  });
  const mongo = createMongo(config, { maxPoolSize: 5 });
  let now = new Date('2026-06-01T06:00:00Z'); // Monday 09:00 in Chișinău (EEST)
  const deferred: Promise<unknown>[] = [];
  const sentMail: MailMessage[] = [];
  const deps = createDeps(config, mongo, {
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
  await mongo.client.connect();
  await migrate(deps);
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
    flush: () => Promise.all(deferred.splice(0)),
    client: (opts?: ClientOptions) => new TestClient(app, opts),
    seed: (options?: Parameters<typeof runSeed>[1]) => runSeed(deps, options),
    async close() {
      await mongo.db.dropDatabase();
      await mongo.client.close();
    },
  };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

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

    const res = await this.app.request(path, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
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
  return { client, user: res.body.user as { id: string; email: string } };
}

export async function loginAs(ctx: TestContext, email: string, password: string) {
  const client = ctx.client();
  const res = await client.post('/api/auth/login', { email, password, remember: true });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return client;
}
