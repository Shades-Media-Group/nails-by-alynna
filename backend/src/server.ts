import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { createApp } from './app';
import { loadConfig, type AppConfig } from './config';
import { timingSafeEqualStr } from './lib/crypto';
import { loadDotEnv } from './lib/dotenv';
import { createDeps, createMongo, migrate } from './runtime';

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
  const mongo = createMongo(config);
  const deps = createDeps(config, mongo, {
    clientIp: clientIpResolver(config),
    defer: (task) => {
      task.catch((error) => console.error('[defer] background task failed', error));
    },
  });

  await mongo.client.connect();
  await migrate(deps);

  const app = createApp(deps);
  const hostname = process.env.HOST || '127.0.0.1';
  const server = serve({ fetch: app.fetch, port: config.port, hostname }, (info) => {
    console.info(`[api] ${config.env} server on http://${hostname}:${info.port} (db: ${config.mongo.dbName})`);
  });

  const shutdown = async (signal: string) => {
    console.info(`[api] ${signal} received, shutting down`);
    server.close();
    await mongo.client.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
