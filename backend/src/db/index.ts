import { MongoClient, type Collection, type Db } from 'mongodb';
import type { AppConfig } from '../config';
import type {
  AppointmentDoc,
  AuditLogDoc,
  CategoryDoc,
  MetaDoc,
  PasswordResetDoc,
  RateLimitDoc,
  ServiceDoc,
  SessionDoc,
  SettingsDoc,
  StaffDoc,
  TimeOffDoc,
  UserDoc,
} from './types';

export interface Collections {
  users: Collection<UserDoc>;
  sessions: Collection<SessionDoc>;
  passwordResets: Collection<PasswordResetDoc>;
  rateLimits: Collection<RateLimitDoc>;
  categories: Collection<CategoryDoc>;
  services: Collection<ServiceDoc>;
  staff: Collection<StaffDoc>;
  timeOff: Collection<TimeOffDoc>;
  appointments: Collection<AppointmentDoc>;
  settings: Collection<SettingsDoc>;
  auditLogs: Collection<AuditLogDoc>;
  meta: Collection<MetaDoc>;
}

export function collections(db: Db): Collections {
  return {
    users: db.collection<UserDoc>('users'),
    sessions: db.collection<SessionDoc>('sessions'),
    passwordResets: db.collection<PasswordResetDoc>('password_resets'),
    rateLimits: db.collection<RateLimitDoc>('rate_limits'),
    categories: db.collection<CategoryDoc>('categories'),
    services: db.collection<ServiceDoc>('services'),
    staff: db.collection<StaffDoc>('staff'),
    timeOff: db.collection<TimeOffDoc>('time_off'),
    appointments: db.collection<AppointmentDoc>('appointments'),
    settings: db.collection<SettingsDoc>('settings'),
    auditLogs: db.collection<AuditLogDoc>('audit_logs'),
    meta: db.collection<MetaDoc>('meta'),
  };
}

/** Bump when indexes change; the runtime re-applies them once per version. */
export const SCHEMA_VERSION = 2;

export async function ensureIndexes(db: Db): Promise<void> {
  const c = collections(db);
  await Promise.all([
    c.users.createIndexes([
      { key: { email: 1 }, unique: true, name: 'email_unique' },
      {
        key: { googleId: 1 },
        unique: true,
        name: 'google_unique',
        partialFilterExpression: { googleId: { $type: 'string' } },
      },
      { key: { role: 1, createdAt: -1 }, name: 'role_created' },
    ]),
    c.sessions.createIndexes([
      { key: { tokenHash: 1 }, unique: true, name: 'token_unique' },
      {
        key: { prevTokenHash: 1 },
        name: 'prev_token',
        partialFilterExpression: { prevTokenHash: { $type: 'string' } },
      },
      { key: { userId: 1, lastUsedAt: -1 }, name: 'user_sessions' },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl' },
    ]),
    c.passwordResets.createIndexes([
      { key: { tokenHash: 1 }, unique: true, name: 'token_unique' },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl' },
    ]),
    c.rateLimits.createIndexes([{ key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl' }]),
    c.categories.createIndexes([
      { key: { order: 1 }, name: 'order' },
      // One document per default entry, even if two processes sync at the same moment.
      { key: { defaultKey: 1 }, unique: true, name: 'default_key', partialFilterExpression: { defaultKey: { $type: 'string' } } },
    ]),
    c.services.createIndexes([
      { key: { categoryId: 1, order: 1 }, name: 'category_order' },
      { key: { defaultKey: 1 }, unique: true, name: 'default_key', partialFilterExpression: { defaultKey: { $type: 'string' } } },
    ]),
    c.staff.createIndexes([{ key: { order: 1 }, name: 'order' }]),
    c.timeOff.createIndexes([{ key: { staffId: 1, start: 1, end: 1 }, name: 'staff_range' }]),
    c.appointments.createIndexes([
      { key: { staffId: 1, start: 1 }, name: 'staff_start' },
      { key: { clientId: 1, start: -1 }, name: 'client_start' },
      { key: { start: 1, status: 1 }, name: 'start_status' },
      { key: { code: 1 }, unique: true, name: 'code_unique' },
    ]),
    // Keep one year of audit history (the TTL index also serves newest-first sorting).
    c.auditLogs.createIndexes([{ key: { at: 1 }, expireAfterSeconds: 365 * 24 * 3600, name: 'ttl' }]),
  ]);
}

export interface MongoHandle {
  client: MongoClient;
  db: Db;
}

export function createMongo(config: AppConfig, overrides?: { maxPoolSize?: number }): MongoHandle {
  const client = new MongoClient(config.mongo.uri, {
    appName: 'nails-by-alynna',
    maxPoolSize: overrides?.maxPoolSize ?? config.mongo.maxPoolSize ?? 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 10_000,
    maxIdleTimeMS: 60_000,
    retryWrites: true,
  });
  return { client, db: client.db(config.mongo.dbName) };
}
