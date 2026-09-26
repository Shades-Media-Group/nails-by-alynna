import { z } from 'zod';

/**
 * Runtime configuration, parsed once from `process.env`. Invalid configuration fails fast with
 * a readable message.
 */

const optionalString = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v === '' ? undefined : v))
  .optional();

const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:5180'),
  ALLOWED_ORIGINS: optionalString,
  /** PostgreSQL 10+: postgres://user:password@host:5432/database */
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_SECRET_PREVIOUS: optionalString,
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
  REMEMBER_ME_DAYS: z.coerce.number().int().min(1).max(400).default(365),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  PASSWORD_HASH_COST: z.enum(['standard', 'fast']).default('standard'),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  MAIL_FROM: optionalString,
  /** EmailJS (preferred when set): the three ids from the EmailJS dashboard, plus the optional private key. */
  EMAILJS_SERVICE_ID: optionalString,
  EMAILJS_TEMPLATE_ID: optionalString,
  EMAILJS_PUBLIC_KEY: optionalString,
  EMAILJS_PRIVATE_KEY: optionalString,
  /** Web Push (VAPID). Generate a pair once: npx web-push generate-vapid-keys */
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: optionalString,
  /** Secret for POST /api/internal/tick (external cron); PROXY_SECRET is used when empty. */
  CRON_SECRET: z.string().min(24, 'CRON_SECRET must be at least 24 characters').optional(),
  /** How often the server itself sends due reminders (seconds); 0 = only the external cron. */
  NOTIFICATIONS_INTERVAL_SEC: z.coerce.number().int().min(0).max(3600).default(60),
  TRUST_PROXY: z.stringbool().default(false),
  /** Shared secret with the Cloudflare Worker proxy; when set, only proxied requests are served. */
  PROXY_SECRET: z.string().min(32, 'PROXY_SECRET must be at least 32 characters').optional(),
  RATE_LIMITS: z.enum(['on', 'off']).default('on'),
  /** One-tap demo sign-in buttons (demo accounts are read-only either way). */
  // off (default) | on (every role) | a comma-separated list, e.g. "client" or "client,admin".
  DEMO_LOGIN: z
    .string()
    .regex(/^(on|off|(client|admin|administrator)(,(client|admin|administrator))*)$/, 'use off, on or roles like client,admin')
    .optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

export type Role = 'client' | 'admin' | 'administrator';

export type MailConfig =
  | { provider: 'emailjs'; serviceId: string; templateId: string; publicKey: string; privateKey?: string }
  | { provider: 'resend'; resendApiKey: string; from: string };

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  appUrl: string;
  allowedOrigins: string[];
  database: { url: string; poolSize?: number };
  jwt: {
    secret: Uint8Array;
    previousSecret?: Uint8Array;
    accessTtlSec: number;
    issuer: string;
    audience: string;
  };
  session: { rememberDays: number; sessionHours: number };
  passwordHashCost: 'standard' | 'fast';
  google?: { clientId: string; clientSecret: string; redirectUri: string };
  /** Email transport: EmailJS wins when both it and Resend are configured. */
  mail?: MailConfig;
  push?: { publicKey: string; privateKey: string; subject: string };
  /** Accepted in the x-nba-cron-key header of POST /api/internal/tick (none = endpoint off). */
  cronSecret?: string;
  notificationsIntervalSec: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  proxySecret?: string;
  rateLimits: boolean;
  /** Roles whose shared demo account may sign in. Empty = demo switched off (the default). */
  demoRoles: Role[];
  port: number;
}

export function loadConfig(source: Record<string, unknown>): AppConfig {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = source[key];
    // Empty values (e.g. `GOOGLE_CLIENT_ID=` in .env) mean "not set".
    if (typeof value === 'string' && value.trim() === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      picked[key] = typeof value === 'string' ? value : String(value);
    }
  }

  const parsed = schema.safeParse(picked);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }
  const e = parsed.data;
  const appUrl = e.APP_URL.replace(/\/+$/, '');
  const isProd = e.APP_ENV === 'production';
  const encoder = new TextEncoder();

  if (isProd && e.PASSWORD_HASH_COST === 'fast') {
    throw new Error('Invalid configuration: PASSWORD_HASH_COST=fast is not allowed in production');
  }
  if (isProd && e.RATE_LIMITS === 'off') {
    throw new Error('Invalid configuration: RATE_LIMITS=off is not allowed in production');
  }
  // Secure cookies and Google's redirect rules both need the public HTTPS address.
  if (isProd && !appUrl.startsWith('https://')) {
    throw new Error('Invalid configuration: APP_URL must be the public https:// address of the app in production');
  }
  if (Boolean(e.GOOGLE_CLIENT_ID) !== Boolean(e.GOOGLE_CLIENT_SECRET)) {
    throw new Error('Invalid configuration: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither');
  }
  if (e.GOOGLE_CLIENT_ID && !e.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')) {
    throw new Error('Invalid configuration: GOOGLE_CLIENT_ID should end with .apps.googleusercontent.com');
  }
  const emailJsParts = [e.EMAILJS_SERVICE_ID, e.EMAILJS_TEMPLATE_ID, e.EMAILJS_PUBLIC_KEY];
  if (emailJsParts.some(Boolean) && !emailJsParts.every(Boolean)) {
    throw new Error('Invalid configuration: set EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID and EMAILJS_PUBLIC_KEY together, or none');
  }
  if (e.EMAILJS_PRIVATE_KEY && !e.EMAILJS_SERVICE_ID) {
    throw new Error('Invalid configuration: EMAILJS_PRIVATE_KEY needs EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID and EMAILJS_PUBLIC_KEY');
  }
  if (Boolean(e.VAPID_PUBLIC_KEY) !== Boolean(e.VAPID_PRIVATE_KEY)) {
    throw new Error('Invalid configuration: set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither');
  }
  // Push services (Apple's in particular) reject a VAPID subject that is not mailto: or https:.
  const vapidSubject = e.VAPID_SUBJECT ?? (appUrl.startsWith('https://') ? appUrl : undefined);
  if (e.VAPID_PUBLIC_KEY && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(vapidSubject ?? '')) {
    throw new Error('Invalid configuration: VAPID_SUBJECT must be a mailto: address or an https:// URL');
  }

  const allowedOrigins = new Set<string>([new URL(appUrl).origin]);
  for (const origin of (e.ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = origin.trim();
    if (trimmed) allowedOrigins.add(new URL(trimmed).origin);
  }

  return {
    env: e.APP_ENV,
    isProd,
    appUrl,
    allowedOrigins: [...allowedOrigins],
    database: { url: e.DATABASE_URL, poolSize: e.DATABASE_POOL_SIZE },
    jwt: {
      secret: encoder.encode(e.JWT_SECRET),
      previousSecret: e.JWT_SECRET_PREVIOUS ? encoder.encode(e.JWT_SECRET_PREVIOUS) : undefined,
      accessTtlSec: e.ACCESS_TOKEN_TTL_MIN * 60,
      issuer: 'nails-by-alynna',
      audience: 'nails-by-alynna:app',
    },
    session: { rememberDays: e.REMEMBER_ME_DAYS, sessionHours: e.SESSION_TTL_HOURS },
    passwordHashCost: e.PASSWORD_HASH_COST,
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? {
            clientId: e.GOOGLE_CLIENT_ID,
            clientSecret: e.GOOGLE_CLIENT_SECRET,
            redirectUri: `${appUrl}/api/auth/google/callback`,
          }
        : undefined,
    mail:
      e.EMAILJS_SERVICE_ID && e.EMAILJS_TEMPLATE_ID && e.EMAILJS_PUBLIC_KEY
        ? {
            provider: 'emailjs',
            serviceId: e.EMAILJS_SERVICE_ID,
            templateId: e.EMAILJS_TEMPLATE_ID,
            publicKey: e.EMAILJS_PUBLIC_KEY,
            privateKey: e.EMAILJS_PRIVATE_KEY,
          }
        : e.RESEND_API_KEY && e.MAIL_FROM
          ? { provider: 'resend', resendApiKey: e.RESEND_API_KEY, from: e.MAIL_FROM }
          : undefined,
    push:
      e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && vapidSubject
        ? { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: vapidSubject }
        : undefined,
    cronSecret: e.CRON_SECRET ?? e.PROXY_SECRET,
    notificationsIntervalSec: e.NOTIFICATIONS_INTERVAL_SEC,
    // Secure cookies need HTTPS; local http://localhost development cannot use them.
    cookieSecure: appUrl.startsWith('https://'),
    trustProxy: e.TRUST_PROXY,
    proxySecret: e.PROXY_SECRET,
    rateLimits: e.RATE_LIMITS === 'on',
    demoRoles: parseDemoRoles(e.DEMO_LOGIN),
    port: e.PORT,
  };
}

const DEMO_ROLES: Role[] = ['client', 'admin', 'administrator'];

function parseDemoRoles(value: string | undefined): Role[] {
  if (!value || value === 'off') return [];
  if (value === 'on') return [...DEMO_ROLES];
  const roles = new Set(value.split(','));
  return DEMO_ROLES.filter((role) => roles.has(role));
}
