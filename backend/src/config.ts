import { z } from 'zod';

/**
 * Runtime configuration, parsed once from `process.env` (Node) or the Worker `env`
 * bindings (Cloudflare). Invalid configuration fails fast with a readable message.
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
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB: z.string().min(1).default('nails_by_alynna'),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(100).optional(),
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
  TRUST_PROXY: z.stringbool().default(false),
  /** Shared secret with the Cloudflare Worker proxy; when set, only proxied requests are served. */
  PROXY_SECRET: z.string().min(32, 'PROXY_SECRET must be at least 32 characters').optional(),
  RATE_LIMITS: z.enum(['on', 'off']).default('on'),
  /** One-tap demo sign-in buttons (demo accounts are read-only either way). */
  DEMO_LOGIN: z.enum(['on', 'off']).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

export type Role = 'client' | 'admin' | 'administrator';

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  appUrl: string;
  allowedOrigins: string[];
  mongo: { uri: string; dbName: string; maxPoolSize?: number };
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
  mail?: { resendApiKey: string; from: string };
  cookieSecure: boolean;
  trustProxy: boolean;
  proxySecret?: string;
  rateLimits: boolean;
  demoLogin: boolean;
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
    mongo: { uri: e.MONGODB_URI, dbName: e.MONGODB_DB, maxPoolSize: e.MONGODB_MAX_POOL_SIZE },
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
      e.RESEND_API_KEY && e.MAIL_FROM
        ? { resendApiKey: e.RESEND_API_KEY, from: e.MAIL_FROM }
        : undefined,
    // Secure cookies need HTTPS; local http://localhost development cannot use them.
    cookieSecure: appUrl.startsWith('https://'),
    trustProxy: e.TRUST_PROXY,
    proxySecret: e.PROXY_SECRET,
    rateLimits: e.RATE_LIMITS === 'on',
    // Off in production unless explicitly enabled.
    demoLogin: e.DEMO_LOGIN ? e.DEMO_LOGIN === 'on' : !isProd,
    port: e.PORT,
  };
}
