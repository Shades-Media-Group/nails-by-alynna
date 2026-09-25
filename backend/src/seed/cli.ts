import { loadConfig } from '../config';
import { loadDotEnv } from '../lib/dotenv';
import { createDeps, createMongo, migrate } from '../runtime';
import { runSeed } from './run';

/**
 * yarn seed [--demo] [--reset-admin-password]
 * Reads .env (or the real environment). Safe to run repeatedly; also works against Atlas:
 *   MONGODB_URI="mongodb+srv://…" SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… yarn seed
 */

loadDotEnv('.env');

const args = new Set(process.argv.slice(2));
const config = loadConfig(process.env);
const mongo = createMongo(config);
const deps = createDeps(config, mongo, { clientIp: () => '127.0.0.1', defer: () => undefined });

const env = process.env;
const wantDemo = args.has('--demo') || env.SEED_DEMO === 'true';
if (wantDemo && config.isProd) {
  console.error('Refusing to create demo data when APP_ENV=production.');
  process.exit(1);
}

const admin =
  env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD
    ? {
        email: env.SEED_ADMIN_EMAIL,
        password: env.SEED_ADMIN_PASSWORD,
        name: env.SEED_ADMIN_NAME || 'Alina',
        surname: env.SEED_ADMIN_SURNAME || 'Admin',
        resetPassword: args.has('--reset-admin-password'),
      }
    : undefined;

if (admin && admin.password.length < 10) {
  console.error('SEED_ADMIN_PASSWORD must be at least 10 characters.');
  process.exit(1);
}

try {
  await mongo.client.connect();
  await migrate(deps);
  console.info(`Seeding ${config.mongo.dbName}…`);
  await runSeed(deps, {
    admin,
    demo: wantDemo ? { password: env.SEED_DEMO_PASSWORD || 'demo-password-2026' } : undefined,
    log: (message) => console.info(`  ${message}`),
  });
  if (!admin) console.info('  (no SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD — administrator not created)');
  console.info('Done.');
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await mongo.client.close();
}
