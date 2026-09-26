import type { AppConfig } from '../config';
import { Database, type Collection } from './pg';
import type {
  AppointmentDoc,
  AuditLogDoc,
  CategoryDoc,
  MetaDoc,
  InviteDoc,
  NotificationLogDoc,
  OtpCodeDoc,
  PasswordResetDoc,
  PromoCodeDoc,
  PushSubscriptionDoc,
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
  invites: Collection<InviteDoc>;
  rateLimits: Collection<RateLimitDoc>;
  categories: Collection<CategoryDoc>;
  services: Collection<ServiceDoc>;
  staff: Collection<StaffDoc>;
  timeOff: Collection<TimeOffDoc>;
  appointments: Collection<AppointmentDoc>;
  settings: Collection<SettingsDoc>;
  auditLogs: Collection<AuditLogDoc>;
  meta: Collection<MetaDoc>;
  otpCodes: Collection<OtpCodeDoc>;
  pushSubscriptions: Collection<PushSubscriptionDoc>;
  notificationLog: Collection<NotificationLogDoc>;
  promoCodes: Collection<PromoCodeDoc>;
}

export function collections(db: Database): Collections {
  return {
    users: db.collection<UserDoc>('users'),
    sessions: db.collection<SessionDoc>('sessions'),
    passwordResets: db.collection<PasswordResetDoc>('password_resets'),
    invites: db.collection<InviteDoc>('invites'),
    rateLimits: db.collection<RateLimitDoc>('rate_limits'),
    categories: db.collection<CategoryDoc>('categories'),
    services: db.collection<ServiceDoc>('services'),
    staff: db.collection<StaffDoc>('staff'),
    timeOff: db.collection<TimeOffDoc>('time_off'),
    appointments: db.collection<AppointmentDoc>('appointments'),
    settings: db.collection<SettingsDoc>('settings'),
    auditLogs: db.collection<AuditLogDoc>('audit_logs'),
    meta: db.collection<MetaDoc>('meta'),
    otpCodes: db.collection<OtpCodeDoc>('otp_codes'),
    pushSubscriptions: db.collection<PushSubscriptionDoc>('push_subscriptions'),
    notificationLog: db.collection<NotificationLogDoc>('notification_log'),
    promoCodes: db.collection<PromoCodeDoc>('promo_codes'),
  };
}

/** Bump when indexes change; the runtime re-applies them once per version. */
export const SCHEMA_VERSION = 4;

export async function ensureIndexes(db: Database): Promise<void> {
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
      // Loyalty card number (QR); issued on first use, so only some users have one.
      { key: { memberCode: 1 }, unique: true, name: 'member_code', partialFilterExpression: { memberCode: { $type: 'string' } } },
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
    c.invites.createIndexes([
      { key: { tokenHash: 1 }, unique: true, name: 'token_unique' },
      { key: { userId: 1 }, name: 'user' },
      // Expired links disappear a week after they stop working.
      { key: { expiresAt: 1 }, expireAfterSeconds: 7 * 86_400, name: 'ttl' },
    ]),
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
      // Bookings that used a promo code (a used code can't be deleted).
      { key: { 'promo.promoId': 1 }, name: 'promo', partialFilterExpression: { 'promo.promoId': { $exists: true } } },
    ]),
    c.promoCodes.createIndexes([
      // One code per text, whatever the letter case (codes are stored upper-case).
      { key: { code: 1 }, unique: true, name: 'code_unique' },
      { key: { staffId: 1, createdAt: -1 }, name: 'staff_created' },
    ]),
    // Keep one year of audit history (the TTL index also serves newest-first sorting).
    c.auditLogs.createIndexes([{ key: { at: 1 }, expireAfterSeconds: 365 * 24 * 3600, name: 'ttl' }]),
  ]);
}

/** Indexes of the notification collections; tracked on its own, apart from SCHEMA_VERSION. */
const NOTIFICATIONS_SCHEMA_VERSION = 1;
const GRANDFATHER_ID = 'emailVerificationGrandfathered';

/** The indexes of the email-code, push and notification-log collections. */
export async function ensureNotificationIndexes(db: Database): Promise<void> {
  const c = collections(db);
  await Promise.all([
    c.otpCodes.createIndexes([
      { key: { purpose: 1, email: 1, createdAt: -1 }, name: 'purpose_email' },
      { key: { userId: 1, purpose: 1, createdAt: -1 }, name: 'user_purpose' },
      // Kept a day past expiry (resend cooldown, attempt history), then removed.
      { key: { expiresAt: 1 }, expireAfterSeconds: 86_400, name: 'ttl' },
    ]),
    c.pushSubscriptions.createIndexes([{ key: { userId: 1 }, name: 'user' }]),
    c.notificationLog.createIndexes([
      { key: { status: 1, retryAt: 1 }, name: 'retry', partialFilterExpression: { status: 'failed' } },
      { key: { createdAt: 1 }, expireAfterSeconds: 180 * 86_400, name: 'ttl' },
    ]),
  ]);
}

/**
 * Email codes, Web Push and reminders: creates their indexes, and once marks every account
 * that existed before email codes as verified, so nobody is locked out. Idempotent; runs at
 * server start after `migrate`. (Uniqueness never depends on these indexes: the notification
 * log and push subscriptions use meaningful `_id`s.)
 */
export async function migrateNotifications(db: Database, now: Date = new Date()): Promise<void> {
  const c = collections(db);
  const schema = await c.meta.findOne({ _id: 'notificationsSchema' });
  if (schema?.value !== NOTIFICATIONS_SCHEMA_VERSION) {
    await ensureNotificationIndexes(db);
    await c.meta.updateOne(
      { _id: 'notificationsSchema' },
      { $set: { value: NOTIFICATIONS_SCHEMA_VERSION, updatedAt: now } },
      { upsert: true },
    );
  }

  // The cutoff is claimed with one atomic insert, so a second server starting at the same
  // moment cannot move it; a run interrupted halfway finishes on the next start.
  let marker = await c.meta.findOne({ _id: GRANDFATHER_ID });
  if (!marker) {
    try {
      await c.meta.insertOne({ _id: GRANDFATHER_ID, value: { cutoff: now, done: false }, updatedAt: now });
    } catch (error) {
      if ((error as { code?: number } | null)?.code !== 11000) throw error;
    }
    marker = await c.meta.findOne({ _id: GRANDFATHER_ID });
  }
  const state = marker?.value as { cutoff?: Date; done?: boolean } | undefined;
  if (state?.cutoff && !state.done) {
    await c.users.updateMany(
      { emailVerifiedAt: null, createdAt: { $lte: state.cutoff } },
      { $set: { emailVerifiedAt: state.cutoff, emailGrandfathered: true } },
    );
    await c.meta.updateOne({ _id: GRANDFATHER_ID }, { $set: { value: { cutoff: state.cutoff, done: true }, updatedAt: now } });
  }
}

/** The PostgreSQL connection pool and its collections (see ./pg); nothing connects until first use. */
export function createDatabase(config: AppConfig, overrides?: { poolSize?: number; schema?: string }): Database {
  return new Database({
    url: config.database.url,
    poolSize: overrides?.poolSize ?? config.database.poolSize ?? 10,
    schema: overrides?.schema,
  });
}

export { Database, describeDatabase, startTtlMonitor, type Filter } from './pg';
