import { DurableObject } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { createApp } from './app';
import { loadConfig } from './config';
import type { AppEnv } from './context';
import { createDeps, createMongo, migrate } from './runtime';

/**
 * Cloudflare Workers entry.
 *
 * Workers cannot share a TCP connection across requests, so the API runs inside a single
 * Durable Object that owns a warm MongoDB connection pool (~35 ms queries instead of a
 * ~300 ms reconnect per request). The Worker only forwards /api/* to it.
 */

export interface Env {
  API_SERVER: DurableObjectNamespace;
  /** Where the Durable Object is first created — pick the region of your MongoDB cluster. */
  DO_LOCATION_HINT?: string;
  [binding: string]: unknown;
}

export class ApiServer extends DurableObject<Env> {
  private readonly app: Hono<AppEnv>;
  private readonly deps: ReturnType<typeof createDeps>;
  private migrated: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const config = loadConfig(env);
    const mongo = createMongo(config, { maxPoolSize: config.mongo.maxPoolSize ?? 3 });
    this.deps = createDeps(config, mongo, {
      clientIp: (c) => c.req.header('cf-connecting-ip') ?? '0.0.0.0',
      defer: (task) =>
        ctx.waitUntil(task.catch((error) => console.error('[defer] background task failed', error))),
    });
    this.app = createApp(this.deps);
  }

  override async fetch(request: Request): Promise<Response> {
    this.migrated ??= migrate(this.deps).catch((error) => {
      this.migrated = null; // retry on the next request
      throw error;
    });
    await this.migrated;
    return this.app.fetch(request);
  }
}

const LOCATION_HINTS = new Set(['wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    }
    const id = env.API_SERVER.idFromName('primary');
    const hint = env.DO_LOCATION_HINT && LOCATION_HINTS.has(env.DO_LOCATION_HINT) ? env.DO_LOCATION_HINT : undefined;
    return env.API_SERVER.get(id, hint ? { locationHint: hint } : undefined).fetch(request);
  },
};
