import type { Context } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { AppError, validationError } from './errors';

/** Parse and validate a JSON request body. Unknown keys are stripped by zod objects. */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  const result = schema.safeParse(body);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/** Parse and validate the query string. */
export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/** Parse a route param as an ObjectId (404 on malformed ids, so ids are not probed). */
export function paramId(c: Context, name = 'id'): ObjectId {
  const raw = c.req.param(name);
  if (!raw || !ObjectId.isValid(raw) || !/^[a-f\d]{24}$/i.test(raw)) {
    throw new AppError(404, 'NOT_FOUND', 'Not found');
  }
  return new ObjectId(raw);
}

// ── Shared field schemas (messages are codes the frontend translates) ────────

export const LOCALES = ['ro', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const localeSchema = z.enum(LOCALES);

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'invalid_id')
  .transform((v) => new ObjectId(v));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'too_long')
  .pipe(z.email({ error: 'invalid_email' }));

export const personNameSchema = z
  .string()
  .trim()
  .min(1, 'required')
  .max(60, 'too_long')
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u, 'invalid_name');

export const phoneSchema = z
  .string()
  .trim()
  .max(32, 'too_long')
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
      return z.NEVER;
    }
    return normalized;
  });

/** Normalises phone numbers to E.164. Local Moldovan numbers (0XX XXX XXX) get +373. */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return compact;
  if (/^00[1-9]\d{6,14}$/.test(compact)) return `+${compact.slice(2)}`;
  if (/^0\d{8}$/.test(compact)) return `+373${compact.slice(1)}`;
  if (/^[67]\d{7}$/.test(compact)) return `+373${compact}`;
  return null;
}

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234',
  '11223344', '12121212', '123123123', 'password', 'password1', 'password123', 'passw0rd',
  'qwertyui', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4', 'asdfghjk',
  'zxcvbnm1', 'iloveyou', 'iloveyou1', 'sunshine', 'princess', 'football', 'baseball',
  'welcome1', 'welcome123', 'admin123', 'administrator', 'letmein1', 'abc12345', 'abcd1234',
  'aa123456', 'monkey12', 'dragon12', 'superman', 'trustno1', 'starwars', 'whatever',
  'michelle', 'jennifer', 'nicole12', 'charlie1', 'computer', 'internet', 'samsung1',
  'parola123', 'parola12', 'moldova1', 'chisinau', 'alina123', 'alynna123', 'nails123',
  'manicure', 'manichiura', 'маникюр', 'пароль123', 'qwerty12', 'йцукенгш', '1qaz2wsx',
]);

export const passwordSchema = z
  .string()
  .min(8, 'too_short')
  .max(128, 'too_long')
  .refine((v) => v.trim().length >= 8, 'too_short')
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), 'too_common')
  .refine((v) => new Set(v).size >= 4, 'too_simple');

const i18nField = (max: number, required = true) =>
  required
    ? z.string().trim().min(1, 'required').max(max, 'too_long')
    : z.string().trim().max(max, 'too_long').default('');

export const i18nTextSchema = (max = 120) =>
  z.object({ ro: i18nField(max), ru: i18nField(max), en: i18nField(max) });

export const i18nOptionalTextSchema = (max = 600) =>
  z.object({ ro: i18nField(max, false), ru: i18nField(max, false), en: i18nField(max, false) });

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'invalid_date');

export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid_time');

export const isoDateTimeSchema = z.iso.datetime({ offset: true, error: 'invalid_datetime' });

export const idListSchema = (max = 10) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')))
    .pipe(
      z
        .array(z.string().trim().regex(/^[a-f\d]{24}$/i, 'invalid_id'))
        .min(1, 'required')
        .max(max, 'too_many'),
    )
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))].map((id) => new ObjectId(id)));
