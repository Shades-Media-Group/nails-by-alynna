/**
 * Pre-flight for a server settings file, validated exactly as the API will at start-up:
 *   yarn check-env .env.production
 * Prints a summary without secrets; exits non-zero when the server would refuse to start or
 * placeholders (<…>) are still in the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../src/config';
import { describeDatabase } from '../src/db';
import { parseDotEnv } from '../src/lib/dotenv';

const file = process.argv[2] ?? '.env.production';
if (!existsSync(file)) {
  console.error(`✗ ${file} not found (copy .env.production.template and fill it in)`);
  process.exit(1);
}
const values = parseDotEnv(readFileSync(file, 'utf8'));
const placeholders = Object.entries(values)
  .filter(([key, value]) => /<[^>]+>/.test(value) && !key.startsWith('SEED_') && key !== 'MAIL_FROM')
  .map(([key]) => key);

let config;
try {
  config = loadConfig(values);
} catch (error) {
  console.error(`✗ ${file}: ${(error as Error).message}`);
  process.exit(1);
}

console.info(`✓ ${file} is valid for APP_ENV=${config.env}`);
console.info(`  app            ${config.appUrl}`);
console.info(`  database       PostgreSQL ${describeDatabase(config.database.url)}`);
console.info(`  proxy secret   ${config.proxySecret ? 'set' : 'MISSING (required behind the Worker)'}`);
console.info(`  Google sign-in ${config.google ? `on (redirect ${config.google.redirectUri})` : 'off'}`);
console.info(
  `  email          ${
    config.mail
      ? config.mail.provider === 'smtp'
        ? `SMTP ${config.mail.host}:${config.mail.port} as ${config.mail.user} (from ${config.mail.from})`
        : config.mail.provider === 'emailjs'
          ? `EmailJS (service ${config.mail.serviceId}, template ${config.mail.templateId}, private key ${config.mail.privateKey ? 'set' : 'not set'})`
          : 'Resend'
      : 'off (sign-up codes, password resets and reminders are NOT emailed)'
  }`,
);
console.info(`  web push       ${config.push ? `on (subject ${config.push.subject})` : 'off (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)'}`);
console.info(
  `  reminders      ${config.notificationsIntervalSec > 0 ? `every ${config.notificationsIntervalSec} s` : 'timer off'}` +
    `; cron endpoint ${config.cronSecret ? 'on' : 'off (no CRON_SECRET / PROXY_SECRET)'}`,
);
console.info(`  demo roles     ${config.demoRoles.join(', ') || 'none'}`);
if (placeholders.length > 0) {
  console.error(`✗ still placeholders in: ${placeholders.join(', ')}`);
  process.exit(1);
}
if (config.isProd && !config.proxySecret) process.exit(1);
