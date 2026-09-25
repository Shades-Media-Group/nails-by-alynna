import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDeps, createMongo, migrate } from './runtime';

/** Node.js entry (local development and any Node host). Production on Cloudflare uses worker.ts. */

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — rely on the real environment.
}

const config = loadConfig(process.env);
const mongo = createMongo(config);

const deps = createDeps(config, mongo, {
  clientIp: (c) => {
    if (config.trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? '0.0.0.0';
    } catch {
      return '0.0.0.0';
    }
  },
  defer: (task) => {
    task.catch((error) => console.error('[defer] background task failed', error));
  },
});

await mongo.client.connect();
await migrate(deps);

const app = createApp(deps);
const server = serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.info(`[api] ${config.env} server on http://localhost:${info.port} (db: ${config.mongo.dbName})`);
});

const shutdown = async (signal: string) => {
  console.info(`[api] ${signal} received, shutting down`);
  server.close();
  await mongo.client.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
