import { ObjectId } from 'bson';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AppDeps, AppEnv } from '../../context';
import type { CalendarConnectionDoc, CalendarProvider, StaffDoc, UserDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { randomToken, sha256Base64Url, timingSafeEqualStr } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { sealState } from '../../lib/jwt';
import { isPlaceholderEmail } from '../../lib/placeholder-email';
import { sealSecret, openSecret } from '../../lib/secret-box';
import { LOCALES, type Locale } from '../../lib/validation';
import { STAFF_ROLES } from '../../middleware/auth';
import { OAUTH_PATH, cookieNames } from '../auth/cookies';
import { getSettings } from '../settings';
import { ensureAppleCalendar, findCalendarHome, type AppleAccount } from './caldav';
import { GOOGLE_CALENDAR_SCOPE, createGoogleCalendar, exchangeGoogleCode, googleCalendarExists, rememberAccessToken } from './google';
import { CalendarError } from './http';
import { connectionIdOf, removeRemoteCalendar, syncConnection } from './sync';

/*
 * Connecting a master's own calendar (sync.ts writes to it afterwards).
 *
 * Google: OAuth 2.0 with PKCE and offline access, through the redirect URI already registered
 * for Google sign-in (/api/auth/google/callback). The `state` sent to Google starts with "cal."
 * so the callback knows this flow even without its cookie; the encrypted, 10-minute cookie holds
 * the PKCE verifier, the state and who asked, so the answer only counts in the browser of the
 * signed-in master who started it (a link from someone else's flow fails).
 *
 * Apple: the Apple ID and an app-specific password, checked against iCloud before they are kept.
 */

export const CALENDAR_STATE_PREFIX = 'cal.';
const STATE_TTL_SEC = 600;

const localePath = (locale: Locale) => (locale === 'ro' ? '' : `/${locale}`);

/** Keeps a connection (replacing the master's earlier one for the same provider). */
async function saveConnection(
  deps: AppDeps,
  input: Pick<CalendarConnectionDoc, 'staffId' | 'provider' | 'account' | 'accountId' | 'calendarId' | 'homeUrl' | 'connectedBy'> & { secret: string },
): Promise<string> {
  const id = connectionIdOf(input.provider, input.staffId);
  const now = deps.now();
  await deps.col.calendarConnections.updateOne(
    { _id: id },
    {
      $set: {
        staffId: input.staffId,
        provider: input.provider,
        status: 'active',
        account: input.account,
        accountId: input.accountId,
        secret: await sealSecret(deps.config, input.secret, id),
        calendarId: input.calendarId,
        homeUrl: input.homeUrl,
        connectedBy: input.connectedBy,
        connectedAt: now,
        lastSyncAt: null,
        lastError: null,
        reconciledAt: null,
        updatedAt: now,
      },
      $setOnInsert: { leaseUntil: null, leaseToken: null },
    },
    { upsert: true },
  );
  return id;
}

/**
 * After a (re)connection: a calendar other than before starts from nothing, and one left in
 * another account is deleted there; then every booking is written.
 */
async function afterConnect(deps: AppDeps, id: string, previous: CalendarConnectionDoc | null, calendarId: string, sameAccount: boolean) {
  if (previous && previous.calendarId !== calendarId) {
    await deps.col.calendarSync.deleteMany({ connectionId: id });
    const oldSecret = sameAccount ? null : await openSecret(deps.config, previous.secret, id);
    if (oldSecret) deps.defer(removeRemoteCalendar(deps, previous, oldSecret));
  }
  deps.defer(syncConnection(deps, id, { force: true }));
}

const auditConnect = (deps: AppDeps, actor: UserDoc, staff: Pick<StaffDoc, '_id'>, provider: CalendarProvider, reconnect: boolean) =>
  audit(deps, {
    actorId: actor._id,
    action: `calendar_sync.${provider}_connect`,
    targetType: 'staff',
    targetId: staff._id,
    ...(reconnect ? { meta: { reconnect: true } } : {}),
  });

// ── Google ───────────────────────────────────────────────────────────────────────────────

/** The address of Google's consent screen for this master; sets the flow's cookie. */
export async function startGoogleConnect(deps: AppDeps, c: Context<AppEnv>, user: UserDoc, staff: StaffDoc): Promise<string> {
  const google = deps.config.google;
  if (!google) throw new AppError(409, 'CALENDAR_UNAVAILABLE', 'Google sign-in is not set up on this server');
  const state = `${CALENDAR_STATE_PREFIX}${randomToken(24)}`;
  const verifier = randomToken(48);
  const sealed = await sealState(
    deps.config,
    { flow: 'calendar', state, verifier, userId: user._id.toHexString(), staffId: staff._id.toHexString(), lang: user.locale },
    STATE_TTL_SEC,
  );
  setCookie(c, cookieNames(deps.config).oauth, sealed, {
    httpOnly: true,
    secure: deps.config.cookieSecure,
    sameSite: 'Lax',
    path: OAUTH_PATH,
    maxAge: STATE_TTL_SEC,
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: google.redirectUri,
    response_type: 'code',
    scope: `openid email ${GOOGLE_CALENDAR_SCOPE}`,
    state,
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: 'S256',
    // A refresh token, every time: the calendar is written to long after this visit.
    access_type: 'offline',
    prompt: 'select_account consent',
    ...(isPlaceholderEmail(user.email) ? {} : { login_hint: user.email }),
  }).toString();
  return url.toString();
}

/**
 * Google's answer, at /api/auth/google/callback (the sign-in route hands it over). Always goes
 * back to My schedule, with ?calendar= saying how it went.
 */
export async function finishGoogleConnect(deps: AppDeps, c: Context<AppEnv>, saved: Record<string, unknown> | null): Promise<Response> {
  const lang: Locale = LOCALES.includes(saved?.lang as Locale) ? (saved?.lang as Locale) : 'ro';
  const back = (result: string) => c.redirect(`${deps.config.appUrl}${localePath(lang)}/admin/schedule?calendar=${result}`, 302);
  const { code, state, error } = c.req.query();
  if (!deps.config.google || !saved || saved.flow !== 'calendar') return back('google_failed');
  if (error) return back(error === 'access_denied' ? 'google_cancelled' : 'google_failed');
  if (!code || !state || typeof saved.state !== 'string' || !timingSafeEqualStr(state, saved.state)) return back('google_failed');

  try {
    const userId = typeof saved.userId === 'string' && ObjectId.isValid(saved.userId) ? new ObjectId(saved.userId) : null;
    const staffId = typeof saved.staffId === 'string' && ObjectId.isValid(saved.staffId) ? new ObjectId(saved.staffId) : null;
    const user = userId ? await deps.col.users.findOne({ _id: userId }) : null;
    if (!user || !user.isActive || user.deletedAt || user.isDemo || !STAFF_ROLES.includes(user.role)) return back('google_failed');
    const staff = staffId ? await deps.col.staff.findOne({ _id: staffId, userId: user._id, isActive: true }) : null;
    if (!staff) return back('google_failed');

    const grant = await exchangeGoogleCode(deps, code, String(saved.verifier));
    // Google lets people untick the calendar permission on its consent screen.
    if (!grant.scopes.includes(GOOGLE_CALENDAR_SCOPE)) return back('google_scope');
    if (!grant.refreshToken) return back('google_failed');

    const id = connectionIdOf('google', staff._id);
    rememberAccessToken(deps, id, grant.accessToken, grant.expiresInSec);
    const auth = { key: id, refreshToken: grant.refreshToken };
    const previous = await deps.col.calendarConnections.findOne({ _id: id });
    const sameAccount = Boolean(previous && grant.sub && previous.accountId === grant.sub);
    // The same Google account again: its calendar stays, if it is still there.
    let calendarId = sameAccount && previous && (await googleCalendarExists(deps, auth, previous.calendarId)) ? previous.calendarId : null;
    calendarId ??= await createGoogleCalendar(deps, auth, await getSettings(deps));

    await saveConnection(deps, {
      staffId: staff._id,
      provider: 'google',
      account: grant.email ?? '',
      accountId: grant.sub,
      calendarId,
      homeUrl: null,
      connectedBy: user._id,
      secret: grant.refreshToken,
    });
    await auditConnect(deps, user, staff, 'google', Boolean(previous));
    await afterConnect(deps, id, previous, calendarId, sameAccount);
    return back('google_connected');
  } catch (failure) {
    console.error('[calendar] connecting Google Calendar failed', failure instanceof Error ? failure.message : failure);
    return back('google_failed');
  }
}

// ── Apple (iCloud) ──────────────────────────────────────────────────────────────────────

/**
 * Checks the Apple ID and app-specific password with iCloud, finds or makes the studio's
 * calendar, keeps the connection and starts writing every booking. A CalendarError says why not
 * ('auth': Apple refused them).
 */
export async function connectAppleCalendar(deps: AppDeps, actor: UserDoc, staff: StaffDoc, account: AppleAccount): Promise<void> {
  const id = connectionIdOf('apple', staff._id);
  const previous = await deps.col.calendarConnections.findOne({ _id: id });
  const sameAccount = previous?.account === account.appleId;
  const settings = await getSettings(deps);
  const home = await findCalendarHome(deps, account);
  const calendarId = await ensureAppleCalendar(deps, account, home, settings.name, sameAccount && previous ? previous.calendarId : null);
  await saveConnection(deps, {
    staffId: staff._id,
    provider: 'apple',
    account: account.appleId,
    accountId: null,
    calendarId,
    homeUrl: home,
    connectedBy: actor._id,
    secret: account.password,
  });
  await auditConnect(deps, actor, staff, 'apple', Boolean(previous));
  await afterConnect(deps, id, previous, calendarId, sameAccount);
}

/** How a failed iCloud check reads for the API (anything else is thrown as it is). */
export function appleConnectError(error: unknown): unknown {
  if (!(error instanceof CalendarError)) return error;
  if (error.kind === 'auth') {
    return new AppError(422, 'CALENDAR_AUTH', 'Apple did not accept this Apple ID and app-specific password', {
      fields: { password: 'apple_auth' },
    });
  }
  console.warn(`[calendar] connecting iCloud failed (${error.message})`);
  return new AppError(502, 'CALENDAR_UNREACHABLE', 'iCloud could not be reached; try again');
}
