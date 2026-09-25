import type { AppConfig } from './config';
import type { AppDeps } from './context';
import { collections, createMongo, ensureIndexes, SCHEMA_VERSION, type MongoHandle } from './db';
import { createMailer } from './lib/mailer';
import { createPasswordHasher } from './lib/password';

/** Builds the dependency graph shared by the Node server and the Worker's Durable Object. */
export function createDeps(
  config: AppConfig,
  mongo: MongoHandle,
  runtime: Pick<AppDeps, 'clientIp' | 'defer'> & { now?: () => Date },
): AppDeps {
  return {
    config,
    db: mongo.db,
    col: collections(mongo.db),
    mailer: createMailer(config),
    passwords: createPasswordHasher(config.passwordHashCost),
    now: runtime.now ?? (() => new Date()),
    clientIp: runtime.clientIp,
    defer: runtime.defer,
  };
}

/** Applies indexes once per schema version (tracked in the `meta` collection). */
export async function migrate(deps: AppDeps): Promise<void> {
  const current = await deps.col.meta.findOne({ _id: 'schemaVersion' });
  if (current?.value === SCHEMA_VERSION) return;
  await ensureIndexes(deps.db);
  await deps.col.meta.updateOne(
    { _id: 'schemaVersion' },
    { $set: { value: SCHEMA_VERSION, updatedAt: new Date() } },
    { upsert: true },
  );
}

export { createMongo };
