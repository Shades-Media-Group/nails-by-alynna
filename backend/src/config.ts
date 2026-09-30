import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import { certificateFromEnv, rsaKeyFromEnv } from './lib/pem';

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
  /**
   * Seals what masters' connected calendars need (a Google refresh token, an Apple app-specific
   * password). Empty = derived from JWT_SECRET; set it so that rotating JWT_SECRET keeps them.
   */
  CALENDAR_SYNC_KEY: z.string().min(32, 'CALENDAR_SYNC_KEY must be at least 32 characters').optional(),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
  REMEMBER_ME_DAYS: z.coerce.number().int().min(1).max(400).default(365),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  PASSWORD_HASH_COST: z.enum(['standard', 'fast']).default('standard'),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  /** Sender shown on every email, e.g. "Nails by Alynna <studio@gmail.com>" (SMTP and Resend). */
  MAIL_FROM: optionalString,
  /** SMTP (preferred when set), e.g. Gmail: smtp.gmail.com, 465, the address and a Google App password. */
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
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
  /** Apple Wallet loyalty card: every value but the passphrase, or it stays off (see .env.template). */
  APPLE_WALLET_PASS_TYPE_ID: optionalString,
  APPLE_WALLET_TEAM_ID: optionalString,
  APPLE_WALLET_SIGNER_CERT: optionalString,
  APPLE_WALLET_SIGNER_KEY: optionalString,
  APPLE_WALLET_SIGNER_KEY_PASSPHRASE: optionalString,
  APPLE_WALLET_WWDR_CERT: optionalString,
  /** Google Wallet loyalty card: all three, or it stays off. */
  GOOGLE_WALLET_ISSUER_ID: optionalString,
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: optionalString,
  GOOGLE_WALLET_PRIVATE_KEY: optionalString,
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

type Env = z.infer<typeof schema>;

/** The settings each Wallet needs; with any of them missing, that Wallet is off. */
export const APPLE_WALLET_VARS = [
  'APPLE_WALLET_PASS_TYPE_ID',
  'APPLE_WALLET_TEAM_ID',
  'APPLE_WALLET_SIGNER_CERT',
  'APPLE_WALLET_SIGNER_KEY',
  'APPLE_WALLET_WWDR_CERT',
] as const;
export const GOOGLE_WALLET_VARS = ['GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_WALLET_PRIVATE_KEY'] as const;

export type Role = 'client' | 'admin' | 'administrator';

export type MailConfig =
  | { provider: 'smtp'; host: string; port: number; user: string; password: string; from: string }
  | { provider: 'emailjs'; serviceId: string; templateId: string; publicKey: string; privateKey?: string }
  | { provider: 'resend'; resendApiKey: string; from: string };

export interface AppleWalletConfig {
  passTypeId: string;
  teamId: string;
  /** PEM. The key is held decrypted, so signing needs no passphrase. */
  signerCert: string;
  signerKey: string;
  wwdr: string;
  /** Wallet refuses passes signed after this: Apple turns itself off until a new certificate is in. */
  certificateExpiresAt: Date;
}

export interface GoogleWalletConfig {
  issuerId: string;
  serviceAccountEmail: string;
  privateKey: KeyObject;
}

export interface WalletConfig {
  apple?: AppleWalletConfig;
  google?: GoogleWalletConfig;
  /** A Wallet only partly set up stays off; these are the settings it still lacks. */
  missing: { apple: string[]; google: string[] };
}

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
  /**
   * Keys that seal stored calendar credentials (lib/secret-box.ts), newest first: CALENDAR_SYNC_KEY
   * when set, then JWT_SECRET and JWT_SECRET_PREVIOUS (so values sealed before a rotation still open).
   */
  credentialSecrets: Uint8Array[];
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
  /** The loyalty card in Apple Wallet and Google Wallet (modules/wallet). */
  wallet: WalletConfig;
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
  const smtpParts = [e.SMTP_HOST, e.SMTP_USER, e.SMTP_PASSWORD];
  if (smtpParts.some(Boolean) && !smtpParts.every(Boolean)) {
    throw new Error('Invalid configuration: set SMTP_HOST, SMTP_USER and SMTP_PASSWORD together, or none');
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
    credentialSecrets: [e.CALENDAR_SYNC_KEY, e.JWT_SECRET, e.JWT_SECRET_PREVIOUS]
      .filter((value): value is string => Boolean(value))
      .map((value) => encoder.encode(value)),
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
      e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASSWORD
        ? {
            provider: 'smtp',
            host: e.SMTP_HOST,
            port: e.SMTP_PORT,
            user: e.SMTP_USER,
            // Google shows App passwords in groups of four; the spaces are not part of it.
            password: e.SMTP_PASSWORD.replace(/\s+/g, ''),
            from: e.MAIL_FROM || e.SMTP_USER,
          }
        : e.EMAILJS_SERVICE_ID && e.EMAILJS_TEMPLATE_ID && e.EMAILJS_PUBLIC_KEY
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
    wallet: walletConfig(e),
    port: e.PORT,
  };
}

/**
 * Apple Wallet and Google Wallet switch on once all their settings are in. Settings that are
 * there but wrong (a certificate for another pass type, a key that doesn't match) stop the start
 * with a message saying which one, like every other setting.
 */
function walletConfig(e: Env): WalletConfig {
  const lacking = (names: readonly (keyof Env)[]) => names.filter((name) => !e[name]);
  const apple = lacking(APPLE_WALLET_VARS);
  const google = lacking(GOOGLE_WALLET_VARS);
  const appleTouched = apple.length < APPLE_WALLET_VARS.length || Boolean(e.APPLE_WALLET_SIGNER_KEY_PASSPHRASE);
  return {
    apple: apple.length === 0 ? appleWallet(e) : undefined,
    google: google.length === 0 ? googleWallet(e) : undefined,
    missing: {
      apple: appleTouched ? apple : [],
      google: google.length < GOOGLE_WALLET_VARS.length ? google : [],
    },
  };
}

function appleWallet(e: Env): AppleWalletConfig {
  const passTypeId = e.APPLE_WALLET_PASS_TYPE_ID!;
  const teamId = e.APPLE_WALLET_TEAM_ID!.toUpperCase();
  if (!/^pass\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(passTypeId)) {
    throw new Error('Invalid configuration: APPLE_WALLET_PASS_TYPE_ID is the Pass Type ID, e.g. pass.md.nailsbyalynna.loyalty');
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error('Invalid configuration: APPLE_WALLET_TEAM_ID is the 10-character Team ID of the Apple Developer account');
  }
  const cert = certificateFromEnv('APPLE_WALLET_SIGNER_CERT', e.APPLE_WALLET_SIGNER_CERT!);
  const wwdr = certificateFromEnv('APPLE_WALLET_WWDR_CERT', e.APPLE_WALLET_WWDR_CERT!);
  const key = rsaKeyFromEnv('APPLE_WALLET_SIGNER_KEY', e.APPLE_WALLET_SIGNER_KEY!, {
    name: 'APPLE_WALLET_SIGNER_KEY_PASSPHRASE',
    value: e.APPLE_WALLET_SIGNER_KEY_PASSPHRASE,
  });
  if (!cert.checkPrivateKey(key)) {
    throw new Error('Invalid configuration: APPLE_WALLET_SIGNER_KEY is not the key of APPLE_WALLET_SIGNER_CERT');
  }
  // Apple's pass certificates name their pass type (UID) and team (OU).
  const uid = /^UID=(.+)$/m.exec(cert.subject)?.[1];
  if (uid && uid !== passTypeId) {
    throw new Error(`Invalid configuration: APPLE_WALLET_SIGNER_CERT is for ${uid}, not APPLE_WALLET_PASS_TYPE_ID ${passTypeId}`);
  }
  const team = /^OU=([A-Z0-9]{10})$/m.exec(cert.subject)?.[1];
  if (team && team !== teamId) {
    throw new Error(`Invalid configuration: APPLE_WALLET_SIGNER_CERT belongs to team ${team}, not APPLE_WALLET_TEAM_ID ${teamId}`);
  }
  if (!cert.checkIssued(wwdr) || !cert.verify(wwdr.publicKey)) {
    throw new Error(
      'Invalid configuration: APPLE_WALLET_WWDR_CERT did not issue APPLE_WALLET_SIGNER_CERT (use "Worldwide Developer Relations - G4" from apple.com/certificateauthority)',
    );
  }
  return {
    passTypeId,
    teamId,
    signerCert: cert.toString(),
    signerKey: key.export({ type: 'pkcs8', format: 'pem' }).toString(),
    wwdr: wwdr.toString(),
    certificateExpiresAt: new Date(cert.validTo),
  };
}

function googleWallet(e: Env): GoogleWalletConfig {
  const issuerId = e.GOOGLE_WALLET_ISSUER_ID!;
  const serviceAccountEmail = e.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL!;
  if (!/^\d{6,30}$/.test(issuerId)) {
    throw new Error('Invalid configuration: GOOGLE_WALLET_ISSUER_ID is the Issuer ID (digits) from the Google Pay & Wallet Console');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(serviceAccountEmail)) {
    throw new Error('Invalid configuration: GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL is the service account\'s email ("client_email" in its JSON key)');
  }
  return { issuerId, serviceAccountEmail, privateKey: rsaKeyFromEnv('GOOGLE_WALLET_PRIVATE_KEY', e.GOOGLE_WALLET_PRIVATE_KEY!) };
}

const DEMO_ROLES: Role[] = ['client', 'admin', 'administrator'];

function parseDemoRoles(value: string | undefined): Role[] {
  if (!value || value === 'off') return [];
  if (value === 'on') return [...DEMO_ROLES];
  const roles = new Set(value.split(','));
  return DEMO_ROLES.filter((role) => roles.has(role));
}
