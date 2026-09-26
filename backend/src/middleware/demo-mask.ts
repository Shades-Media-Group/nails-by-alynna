import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context';

/**
 * Demo staff accounts are shared with people outside the studio, so the dashboard they see
 * must not expose real clients. For demo users every admin JSON response is rewritten:
 * people's names, surnames, phones, emails, notes, IPs and devices are masked; business
 * data (services, times, prices, statuses) stays intact so the demo remains meaningful.
 */

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return domain ? `${local.slice(0, 1)}•••@${domain.slice(0, 1)}•••` : '•••';
}

function maskPhone(phone: string): string {
  return phone.length > 3 ? `${phone.slice(0, 4)} ••• ••${phone.slice(-1)}` : '•••';
}

const initial = (value: string) => (value ? `${value.trim().slice(0, 1).toUpperCase()}.` : '');

export function maskPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskPersonalData);
  if (!value || typeof value !== 'object') return value;

  const input = value as Record<string, unknown>;
  const isPerson = 'surname' in input;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(input)) {
    if (typeof field === 'string') {
      if (isPerson && key === 'name') out[key] = `${field.trim().slice(0, 1).toUpperCase()}•••`;
      else if (isPerson && key === 'surname') out[key] = initial(field);
      else if (key === 'email') out[key] = maskEmail(field);
      else if (key === 'phone') out[key] = maskPhone(field);
      else if (['notes', 'staffNotes', 'cancelReason', 'userAgent', 'ip', 'note'].includes(key)) out[key] = field ? '•••' : '';
      else out[key] = field;
    } else {
      out[key] = maskPersonalData(field);
    }
  }
  return out;
}

export const demoMask = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const user = c.get('user');
  if (user?.isDemo !== true) return;
  const type = c.res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return;
  const body = (await c.res.clone().json()) as unknown;
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  c.res = new Response(JSON.stringify(maskPersonalData(body)), { status: c.res.status, headers });
});
