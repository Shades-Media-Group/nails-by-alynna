import { loadConfig } from '../config';
import { loadDotEnv } from '../lib/dotenv';
import { createDeps, createMongo, migrate } from '../runtime';
import { runSeed } from './run';

/**
 * yarn seed [--demo] [--demo-users] [--reset-admin-password]
 *   --demo        demo accounts + sample clients/appointments (refused on production)
 *   --demo-users  only the read-only demo accounts (fine on production)
 * Reads .env (or the real environment). Safe to run repeatedly; also works against Atlas:
 *   ENV_FILE=.env.production yarn seed          (uses the production settings file)
 *   MONGODB_URI="mongodb+srv://…" SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… yarn seed
 */

loadDotEnv(process.env.ENV_FILE ?? '.env');

const args = new Set(process.argv.slice(2));
const config = loadConfig(process.env);
const mongo = createMongo(config);
const deps = createDeps(config, mongo, { clientIp: () => '127.0.0.1', defer: () => undefined });

const env = process.env;
const wantDemoData = args.has('--demo') || env.SEED_DEMO === 'true';
const wantDemoUsers = wantDemoData || args.has('--demo-users');
if (wantDemoData && config.isProd) {
  console.error('Refusing to create sample data when APP_ENV=production (use --demo-users for demo accounts).');
  process.exit(1);
}
const demoPassword = env.SEED_DEMO_PASSWORD || 'nails-demo-2026';

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
    demoUsers: wantDemoUsers ? { password: demoPassword } : undefined,
    demoData: wantDemoData,
    log: (message) => console.info(`  ${message}`),
  });
  if (!admin) console.info('  (no SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD — administrator not created)');
  if (wantDemoUsers) console.info(`  demo password: ${demoPassword}`);
  console.info('Done.');
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await mongo.client.close();
}
