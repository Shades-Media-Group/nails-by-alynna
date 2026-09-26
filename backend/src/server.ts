import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { createApp } from './app';
import { loadConfig, type AppConfig } from './config';
import { describeDatabase, migrateNotifications, startTtlMonitor } from './db';
import { timingSafeEqualStr } from './lib/crypto';
import { loadDotEnv } from './lib/dotenv';
import { startNotificationScheduler } from './modules/notifications';
import { createDatabase, createDeps, migrate } from './runtime';

/**
 * Node.js entry — local development and production on host.md (Plesk Node.js / Passenger).
 * Bundled to a single CommonJS file by `yarn build:node` (dist/node/app.js).
 */

function clientIpResolver(config: AppConfig) {
  return (c: Context): string => {
    // Behind the Cloudflare Worker: trust its client-IP header only with a valid proxy key.
    if (config.proxySecret) {
      const key = c.req.header('x-nba-proxy-key') ?? '';
      const forwarded = c.req.header('x-nba-client-ip');
      if (forwarded && timingSafeEqualStr(key, config.proxySecret)) return forwarded;
    }
    if (config.trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? '0.0.0.0';
    } catch {
      return '0.0.0.0';
    }
  };
}

async function main() {
  loadDotEnv(process.env.ENV_FILE ?? '.env');
  const config = loadConfig(process.env);
  const db = createDatabase(config);
  const deps = createDeps(config, db, {
    clientIp: clientIpResolver(config),
    defer: (task) => {
      task.catch((error) => console.error('[defer] background task failed', error));
    },
  });

  // Listen first: while the database is unreachable the API still answers (health says 503),
  // instead of the process crashing and the host restarting it in a loop.
  const app = createApp(deps);
  const hostname = process.env.HOST || '127.0.0.1';
  const server = serve({ fetch: app.fetch, port: config.port, hostname }, (info) => {
    console.info(`[api] ${config.env} server on http://${hostname}:${info.port} (db: ${describeDatabase(config.database.url)})`);
  });
  let stopReminders: () => void = () => undefined;
  let stopTtl: () => void = () => undefined;
  void prepareDatabase(async () => {
    await db.ping();
    await migrate(deps);
    await migrateNotifications(deps.db);
  }).then(() => {
    // Reminders go out from here every minute; the Cloudflare cron (POST /api/internal/tick)
    // covers the times the host has put an idle app to sleep.
    stopReminders = startNotificationScheduler(deps);
    // Expired sessions, codes, rate-limit windows and old logs (MongoDB's TTL indexes).
    stopTtl = startTtlMonitor(deps.db);
  });

  const shutdown = async (signal: string) => {
    console.info(`[api] ${signal} received, shutting down`);
    stopReminders();
    stopTtl();
    server.close();
    await db.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/** Connects, creates tables, indexes and defaults, retrying with backoff (2 s doubling to 60 s). */
async function prepareDatabase(prepare: () => Promise<void>): Promise<void> {
  for (let delay = 2_000; ; delay = Math.min(delay * 2, 60_000)) {
    try {
      await prepare();
      console.info('[api] database ready');
      return;
    } catch (error) {
      console.error(`[api] database not ready (${(error as Error).message}); retrying in ${delay / 1000} s`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

main().catch((error) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
