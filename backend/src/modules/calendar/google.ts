import type { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { AppointmentDoc, StudioSettings } from '../../db/types';
import { bookingEvent, type EventContext } from './feed';
import { CalendarError, calendarFetch, passingFailure, retryAfterMs } from './http';

/*
 * Google Calendar API v3 for a master's connected Google account. The studio asks only for
 * calendar.app.created: it may make calendars of its own and write events in them, and sees
 * nothing else in the account. Each master gets a calendar named after the studio; each booking
 * is one event in it, with the booking's id as the event id (a MongoDB id is valid base32hex),
 * so writing a booking again replaces its event.
 */

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** 403 reasons that mean "slow down", not "no access". */
const RATE_LIMITED = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']);

/** A connection's way in: its refresh token; `key` names its cached access token. */
export interface GoogleAuth {
  key: string;
  refreshToken: string;
}

// ── Access tokens (an hour each; kept in memory, renewed a minute early) ─────────────────
const accessTokens = new WeakMap<AppDeps, Map<string, { token: string; expiresAt: number }>>();

function tokensOf(deps: AppDeps) {
  let tokens = accessTokens.get(deps);
  if (!tokens) accessTokens.set(deps, (tokens = new Map()));
  return tokens;
}

export function rememberAccessToken(deps: AppDeps, key: string, token: string, expiresInSec: number): void {
  tokensOf(deps).set(key, { token, expiresAt: deps.now().getTime() + Math.max(0, expiresInSec - 60) * 1000 });
}

export function forgetAccessToken(deps: AppDeps, key: string): void {
  tokensOf(deps).delete(key);
}

async function tokenRequest(deps: AppDeps, form: Record<string, string>, label: string) {
  const response = await calendarFetch(
    deps,
    TOKEN_URL,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) },
    label,
  );
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, body };
}

async function accessToken(deps: AppDeps, auth: GoogleAuth, renew: boolean): Promise<string> {
  const cached = tokensOf(deps).get(auth.key);
  if (!renew && cached && cached.expiresAt > deps.now().getTime()) return cached.token;
  const google = deps.config.google;
  if (!google) throw new CalendarError('retry', 'Google sign-in is not configured (GOOGLE_CLIENT_ID)');
  const { response, body } = await tokenRequest(
    deps,
    { client_id: google.clientId, client_secret: google.clientSecret, refresh_token: auth.refreshToken, grant_type: 'refresh_token' },
    'Google sign-in',
  );
  if (response.ok && typeof body.access_token === 'string') {
    rememberAccessToken(deps, auth.key, body.access_token, typeof body.expires_in === 'number' ? body.expires_in : 3600);
    return body.access_token;
  }
  // The master removed the studio's access, changed the password, or the grant expired.
  if (body.error === 'invalid_grant') throw new CalendarError('auth', 'Google access was removed or has expired');
  const passing = passingFailure(response, deps.now(), 'Google sign-in');
  if (passing) throw passing;
  // invalid_client and the like: the studio's own Google settings, not the master's account.
  throw new CalendarError('retry', `Google sign-in refused to renew access (${String(body.error ?? response.status)})`);
}

/** Google's reason for a refusal ("rateLimitExceeded", "forbidden"…). */
async function reasonOf(response: Response): Promise<string> {
  const body = (await response.clone().json().catch(() => null)) as { error?: { errors?: Array<{ reason?: string }>; status?: string } } | null;
  return body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? '';
}

/** One Calendar API call; an access token Google no longer takes is renewed once. */
async function api(deps: AppDeps, auth: GoogleAuth, method: string, path: string, body?: unknown): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(deps, auth, attempt > 0);
    const response = await calendarFetch(
      deps,
      `${API}${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      'Google Calendar',
    );
    if (response.status === 401) {
      forgetAccessToken(deps, auth.key);
      if (attempt === 0) continue;
      throw new CalendarError('auth', 'Google refused the access');
    }
    if (response.status === 403) {
      const reason = await reasonOf(response);
      if (RATE_LIMITED.has(reason)) throw new CalendarError('retry', `Google Calendar: ${reason}`, retryAfterMs(response, deps.now()) ?? 60_000);
      throw new CalendarError('auth', `Google Calendar: ${reason || 'forbidden'}`);
    }
    const passing = passingFailure(response, deps.now(), 'Google Calendar');
    if (passing) throw passing;
    return response;
  }
}

async function refused(response: Response, what: string): Promise<CalendarError> {
  const reason = await reasonOf(response);
  return new CalendarError('rejected', `Google Calendar refused to ${what} (${response.status}${reason ? ` ${reason}` : ''})`);
}

// ── Connecting ──────────────────────────────────────────────────────────────────────────

export interface GoogleGrant {
  refreshToken: string | null;
  accessToken: string;
  expiresInSec: number;
  scopes: string[];
  /** The account (from the ID token): its stable id and email. */
  sub: string | null;
  email: string | null;
}

/**
 * The code from Google's consent screen, exchanged for tokens (with the PKCE verifier). The ID
 * token comes straight from Google's token endpoint over TLS, so its claims are read without
 * checking its signature (OpenID Connect Core 3.1.3.7); issuer and audience are still checked.
 */
export async function exchangeGoogleCode(deps: AppDeps, code: string, verifier: string): Promise<GoogleGrant> {
  const google = deps.config.google;
  if (!google) throw new CalendarError('retry', 'Google sign-in is not configured');
  const { response, body } = await tokenRequest(
    deps,
    {
      code,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: google.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    },
    'Google sign-in',
  );
  if (!response.ok || typeof body.access_token !== 'string') {
    throw new CalendarError('rejected', `Google token exchange failed (${String(body.error ?? response.status)})`);
  }
  let sub: string | null = null;
  let email: string | null = null;
  if (typeof body.id_token === 'string') {
    try {
      const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (GOOGLE_ISSUERS.includes(String(claims.iss)) && audience.includes(google.clientId)) {
        sub = typeof claims.sub === 'string' ? claims.sub : null;
        email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
      }
    } catch {
      // No readable ID token: the connection works the same, only without the account's email.
    }
  }
  return {
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    accessToken: body.access_token,
    expiresInSec: typeof body.expires_in === 'number' ? body.expires_in : 3600,
    scopes: typeof body.scope === 'string' ? body.scope.split(' ') : [],
    sub,
    email,
  };
}

/** Gives the refresh token back to Google (after disconnecting). Best effort. */
export async function revokeGoogleToken(deps: AppDeps, refreshToken: string): Promise<void> {
  await calendarFetch(
    deps,
    REVOKE_URL,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }) },
    'Google sign-in',
  );
}

// ── The studio's calendar in the master's account ───────────────────────────────────────

/** Makes the studio's calendar in the account; its id. */
export async function createGoogleCalendar(deps: AppDeps, auth: GoogleAuth, settings: Pick<StudioSettings, 'name' | 'timezone'>): Promise<string> {
  const response = await api(deps, auth, 'POST', '/calendars', {
    summary: settings.name,
    description: `${settings.name}: bookings, kept up to date by the studio's app.`,
    timeZone: settings.timezone,
  });
  const body = (await response.json().catch(() => null)) as { id?: string } | null;
  if (!response.ok || !body?.id) throw await refused(response, 'make the calendar');
  return body.id;
}

export async function googleCalendarExists(deps: AppDeps, auth: GoogleAuth, calendarId: string): Promise<boolean> {
  const response = await api(deps, auth, 'GET', `/calendars/${encodeURIComponent(calendarId)}`);
  if (response.ok) return true;
  if (response.status === 404 || response.status === 410) return false;
  throw await refused(response, 'find the calendar');
}

/** Deletes the studio's calendar with every event in it (already gone is fine). */
export async function deleteGoogleCalendar(deps: AppDeps, auth: GoogleAuth, calendarId: string): Promise<void> {
  const response = await api(deps, auth, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}`);
  if (!response.ok && response.status !== 404 && response.status !== 410) throw await refused(response, 'delete the calendar');
}

// ── Events ────────────────────────────────────────────────────────────────────────────

/** A booking as a Google Calendar event: the feed's text (feed.ts), Google's shape. */
export function googleEventBody(a: AppointmentDoc, ctx: EventContext) {
  const event = bookingEvent(a, ctx);
  return {
    summary: event.summary,
    description: event.description,
    ...(event.location ? { location: event.location } : {}),
    start: { dateTime: event.start.toISOString(), timeZone: ctx.settings.timezone },
    end: { dateTime: event.end.toISOString(), timeZone: ctx.settings.timezone },
    status: event.tentative ? 'tentative' : 'confirmed',
    transparency: 'opaque',
    sequence: event.sequence,
    source: { title: ctx.settings.name, url: event.url },
  };
}

/**
 * Writes a booking's event: replaces it (a removed one comes back), or makes it the first time.
 * A calendar that is not there any more is reported as 'gone'.
 */
export async function putGoogleEvent(deps: AppDeps, auth: GoogleAuth, calendarId: string, a: AppointmentDoc, ctx: EventContext): Promise<void> {
  const id = a._id.toHexString();
  const events = `/calendars/${encodeURIComponent(calendarId)}/events`;
  let body: Record<string, unknown> = googleEventBody(a, ctx);
  const replace = () => api(deps, auth, 'PUT', `${events}/${id}`, body);
  let response = await replace();
  // Google keeps its own count of changes too: one it thinks is newer is not argued with.
  if (response.status === 400 && /sequence/i.test(await response.clone().text())) {
    body = { ...body };
    delete body.sequence;
    response = await replace();
  }
  if (response.status === 404) {
    response = await api(deps, auth, 'POST', events, { id, ...body });
    if (response.status === 404) throw new CalendarError('gone', 'The Google calendar is not there any more');
    // Made meanwhile by another write: replace it.
    if (response.status === 409) response = await replace();
  }
  if (!response.ok) throw await refused(response, 'save the event');
}

/** Removes a booking's event (already removed is fine). */
export async function deleteGoogleEvent(deps: AppDeps, auth: GoogleAuth, calendarId: string, appointmentId: ObjectId): Promise<void> {
  const response = await api(deps, auth, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${appointmentId.toHexString()}`);
  if (!response.ok && response.status !== 404 && response.status !== 410) throw await refused(response, 'remove the event');
}
