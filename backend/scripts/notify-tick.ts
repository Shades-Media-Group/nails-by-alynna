/**
 * Sends the reminders that are due right now (once) and prints what happened — the same run
 * the server does every minute and POST /api/internal/tick triggers:
 *   npx tsx scripts/notify-tick.ts                      (reads .env)
 *   ENV_FILE=.env.production npx tsx scripts/notify-tick.ts
 * A reminder is due when "start − lead time" has passed (lead: 1 h, 2 h or 1 day, chosen in
 * Profile → Notifications) and the visit was booked before that moment. Each one is sent
 * once: run it twice and the second run reports it under "duplicates".
 */
import { loadConfig } from '../src/config';
import { describeDatabase, migrateNotifications } from '../src/db';
import { loadDotEnv } from '../src/lib/dotenv';
import { runDueNotifications } from '../src/modules/notifications';
import { createDatabase, createDeps } from '../src/runtime';

loadDotEnv(process.env.ENV_FILE ?? '.env');
const config = loadConfig(process.env);
const db = createDatabase(config);
const deps = createDeps(config, db, {
  clientIp: () => '127.0.0.1',
  defer: (task) => {
    task.catch((error) => console.error('[defer] background task failed', error));
  },
});

try {
  await migrateNotifications(deps.db);
  const summary = await runDueNotifications(deps);
  console.info(`[notify] ${describeDatabase(config.database.url)}:`, summary);
  if (!config.mail) console.info('  (no email provider configured: emails were only logged)');
  if (!config.push) console.info('  (no VAPID keys configured: push was skipped)');
} catch (error) {
  console.error('[notify] run failed', error);
  process.exitCode = 1;
} finally {
  await db.close();
}
