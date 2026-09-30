import { ObjectId } from 'bson';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setPushTransport } from '../src/lib/push';
import { openSecret, sealSecret } from '../src/lib/secret-box';
import { GOOGLE_CALENDAR_SCOPE } from '../src/modules/calendar/google';
import { setCalendarFetch } from '../src/modules/calendar/http';
import { runCalendarSync } from '../src/modules/calendar/sync';
import { APP_ORIGIN, createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const MINUTE = 60_000;

let ctx: TestContext;
let gelId: string;
let owner: TestClient;
let alinaId: ObjectId;
let irina: { client: TestClient; staffId: ObjectId };
let google: FakeGoogle;
let icloud: FakeICloud;

// ── Stand-ins for Google and iCloud ─────────────────────────────────────────────────────

const idToken = (claims: Record<string, unknown>) => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', kid: 'test' })}.${part({ iss: 'https://accounts.google.com', aud: CLIENT_ID, ...claims })}.sig`;
};

interface GoogleEvent {
  id: string;
  status: string;
  summary: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
  sequence?: number;
}

/** Google's token endpoint and Calendar API v3, in memory. */
class FakeGoogle {
  calendars = new Map<string, { summary: string; timeZone: string; events: Map<string, GoogleEvent> }>();
  exchanges: URLSearchParams[] = [];
  revoked: string[] = [];
  requests: string[] = [];
  scope = `openid https://www.googleapis.com/auth/userinfo.email ${GOOGLE_CALENDAR_SCOPE}`;
  account = { sub: 'g-alina', email: 'Alina.Master@gmail.com' };
  refreshToken = 'refresh-alina';
  /** The master removed the studio's access in their Google account. */
  accessRemoved = false;
  /** Answers given once to the first request matching `match` ("PUT /calendar/v3/…"). */
  failures: Array<{ match: RegExp; status: number; headers?: Record<string, string>; body?: unknown }> = [];
  private seq = 0;

  fetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    this.requests.push(`${method} ${url.pathname}`);
    const failure = this.failures.findIndex((f) => f.match.test(`${method} ${url.pathname}`));
    if (failure >= 0) {
      const [f] = this.failures.splice(failure, 1);
      return Response.json(f!.body ?? { error: { code: f!.status } }, { status: f!.status, headers: f!.headers });
    }
    const form = () => new URLSearchParams(String(init.body));
    if (url.href === 'https://oauth2.googleapis.com/token') return this.token(form());
    if (url.href === 'https://oauth2.googleapis.com/revoke') {
      this.revoked.push(form().get('token')!);
      return new Response(null, { status: 200 });
    }
    if (url.origin !== 'https://www.googleapis.com' || !url.pathname.startsWith('/calendar/v3/')) throw new Error(`unexpected ${method} ${url.href}`);
    const bearer = new Headers(init.headers).get('authorization') ?? '';
    if (this.accessRemoved || !/^Bearer access-\d+$/.test(bearer)) return Response.json({ error: { code: 401 } }, { status: 401 });
    return this.api(method, url.pathname.slice('/calendar/v3'.length), init.body ? JSON.parse(String(init.body)) : undefined);
  };

  private token(form: URLSearchParams): Response {
    if (form.get('grant_type') === 'authorization_code') {
      this.exchanges.push(form);
      return Response.json({
        access_token: `access-${++this.seq}`,
        expires_in: 3599,
        refresh_token: this.refreshToken,
        scope: this.scope,
        token_type: 'Bearer',
        id_token: idToken(this.account),
      });
    }
    if (this.accessRemoved || form.get('refresh_token') !== this.refreshToken) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: `access-${++this.seq}`, expires_in: 3599 });
  }

  private api(method: string, path: string, body: Record<string, unknown> | undefined): Response {
    const notFound = () => Response.json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, { status: 404 });
    if (path === '/calendars' && method === 'POST') {
      const id = `studio${++this.seq}@group.calendar.google.com`;
      this.calendars.set(id, { summary: String(body!.summary), timeZone: String(body!.timeZone), events: new Map() });
      return Response.json({ id, summary: body!.summary });
    }
    const match = /^\/calendars\/([^/]+)(\/events(?:\/([^/]+))?)?$/.exec(path);
    const calendarId = decodeURIComponent(match?.[1] ?? '');
    const calendar = this.calendars.get(calendarId);
    if (!match || !calendar) return notFound();
    if (!match[2]) {
      if (method === 'DELETE') this.calendars.delete(calendarId);
      return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: calendarId });
    }
    const eventId = match[3];
    if (!eventId && method === 'POST') {
      if (calendar.events.has(String(body!.id))) return Response.json({ error: { code: 409 } }, { status: 409 });
      calendar.events.set(String(body!.id), body as unknown as GoogleEvent);
      return Response.json(body);
    }
    const event = eventId ? calendar.events.get(eventId) : undefined;
    if (!event) return notFound();
    if (method === 'PUT') {
      calendar.events.set(eventId!, { ...(body as unknown as GoogleEvent), id: eventId! });
      return Response.json(body);
    }
    if (method === 'DELETE') {
      // Google keeps a deleted event as cancelled (it can come back); deleting it again is 410.
      if (event.status === 'cancelled') return Response.json({ error: { code: 410 } }, { status: 410 });
      event.status = 'cancelled';
      return new Response(null, { status: 204 });
    }
    return notFound();
  }

  /** The studio's calendar (the only one) and the events in it that are not cancelled. */
  get studio() {
    const [id, calendar] = [...this.calendars.entries()][0] ?? [];
    return { id, calendar, events: [...(calendar?.events.values() ?? [])].filter((e) => e.status !== 'cancelled') };
  }
}

/** iCloud's CalDAV servers, in memory: caldav.icloud.com and the account's p42 server. */
class FakeICloud {
  appleId = 'alina@icloud.com';
  password = 'abcd-efgh-ijkl-mnop';
  homeSet = 'https://p42-caldav.icloud.com:443/123456/calendars/';
  calendars = new Map<string, { name: string; events: Map<string, string> }>([['/123456/calendars/home/', { name: 'Calendar', events: new Map() }]]);
  requests: string[] = [];
  failures: Array<{ match: RegExp; status: number }> = [];

  fetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    this.requests.push(`${method} ${url.host}${url.pathname}`);
    if (!url.host.endsWith('icloud.com')) throw new Error(`unexpected ${method} ${url.href}`);
    const basic = `Basic ${Buffer.from(`${this.appleId}:${this.password}`).toString('base64')}`;
    if (new Headers(init.headers).get('authorization') !== basic) return new Response('Unauthorized', { status: 401 });
    const failure = this.failures.findIndex((f) => f.match.test(`${method} ${url.pathname}`));
    if (failure >= 0) return new Response(null, { status: this.failures.splice(failure, 1)[0]!.status });
    const body = typeof init.body === 'string' ? init.body : '';
    const multistatus = (xml: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, { status: 207, headers: { 'Content-Type': 'text/xml' } });

    if (url.host === 'caldav.icloud.com' && method === 'PROPFIND' && url.pathname === '/') {
      return multistatus(
        '<multistatus xmlns="DAV:"><response xmlns="DAV:"><href>/</href><propstat><prop><current-user-principal xmlns="DAV:"><href xmlns="DAV:">/123456/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>',
      );
    }
    if (url.host === 'caldav.icloud.com' && method === 'PROPFIND' && url.pathname === '/123456/principal/') {
      return multistatus(
        `<multistatus xmlns="DAV:"><response xmlns="DAV:"><href>/123456/principal/</href><propstat><prop><calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">${this.homeSet}</href></calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`,
      );
    }
    if (url.host !== 'p42-caldav.icloud.com') throw new Error(`unexpected ${method} ${url.href}`);
    if (method === 'PROPFIND' && url.pathname === '/123456/calendars/') {
      const rows = [...this.calendars].map(
        ([path, c]) =>
          `<D:response><D:href>${path}</D:href><D:propstat><D:prop><D:displayname>${c.name.replace(/&/g, '&amp;')}</D:displayname><D:resourcetype><D:collection/><C:calendar/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
      );
      return multistatus(
        `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/123456/calendars/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>${rows.join('')}</D:multistatus>`,
      );
    }
    if (method === 'MKCALENDAR') {
      this.calendars.set(url.pathname, { name: /<d:displayname>([^<]*)<\/d:displayname>/.exec(body)?.[1] ?? '', events: new Map() });
      return new Response(null, { status: 201 });
    }
    const object = /^(.*\/)([a-f0-9]{24}\.ics)$/.exec(url.pathname);
    if (object) {
      const calendar = this.calendars.get(object[1]!);
      if (!calendar) return new Response(null, { status: method === 'PUT' ? 409 : 404 });
      if (method === 'PUT') {
        const existed = calendar.events.has(object[2]!);
        calendar.events.set(object[2]!, body);
        return new Response(null, { status: existed ? 204 : 201 });
      }
      if (method === 'DELETE') return new Response(null, { status: calendar.events.delete(object[2]!) ? 204 : 404 });
    }
    if (method === 'DELETE' && this.calendars.delete(url.pathname)) return new Response(null, { status: 204 });
    throw new Error(`unexpected ${method} ${url.href}`);
  };

  /** The studio's calendar in the account (not the account's own "Calendar"). */
  get studio() {
    const entry = [...this.calendars].find(([path]) => path !== '/123456/calendars/home/');
    return { path: entry?.[0], calendar: entry?.[1], events: [...(entry?.[1].events ?? new Map<string, string>()).entries()] };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────

const unfold = (ics: string) => ics.replace(/\r\n /g, '');

async function book(opts: { date?: string; notes?: string } = {}) {
  const { client } = await registerClient(ctx, { name: 'Ana', surname: 'Rusu' });
  const slots = (await client.get(`/api/availability/slots?serviceIds=${gelId}&date=${opts.date ?? '2026-06-03'}&staffId=${alinaId.toHexString()}`)).body.slots as Array<{ start: string }>;
  const res = await client.post('/api/appointments', { serviceIds: [gelId], staffId: alinaId.toHexString(), start: slots[0]!.start, notes: opts.notes ?? '' });
  expect(res.status).toBe(201);
  return { client, id: res.body.appointment.id as string, start: res.body.appointment.start as string, code: res.body.appointment.code as string };
}

/** Connects the owner's (Alina's) Google Calendar the way the app does: consent screen, then callback. */
async function connectGoogle(client = owner) {
  const start = await client.post('/api/admin/team/me/calendar/google');
  expect(start.status).toBe(200);
  const state = new URL(start.body.url).searchParams.get('state')!;
  const back = await client.request('GET', `/api/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`, undefined, {
    'sec-fetch-site': 'cross-site',
  });
  await ctx.flush();
  return { start, back, location: back.headers.get('location') };
}

async function connectApple(client: TestClient, input: Partial<{ appleId: string; password: string }> = {}) {
  const res = await client.post('/api/admin/team/me/calendar/apple', { appleId: icloud.appleId, password: icloud.password, ...input });
  await ctx.flush();
  return res;
}

const rowsOf = (appointmentId: string) => ctx.deps.col.calendarSync.find({ appointmentId: new ObjectId(appointmentId) }).toArray();

beforeAll(async () => {
  ctx = await createTestContext({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'test-secret' });
  // The seeded owner is also the studio's first master (Alina).
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  alinaId = (await ctx.deps.col.staff.findOne({}))!._id;

  // A second master, Irina, with a staff account of her own.
  const team = await owner.get('/api/admin/team/staff');
  const created = await owner.post('/api/admin/team/staff', {
    name: 'Irina',
    title: { ro: 'Maestră', ru: 'Мастер', en: 'Nail artist' },
    weekly: team.body.staff[0].weekly,
  });
  const registered = await registerClient(ctx, { name: 'Irina', surname: 'Master' });
  const userId = new ObjectId(registered.user.id);
  await ctx.deps.col.users.updateOne({ _id: userId }, { $set: { role: 'admin' } });
  const staffId = new ObjectId(created.body.staff.id as string);
  await ctx.deps.col.staff.updateOne({ _id: staffId }, { $set: { userId } });
  irina = { client: registered.client, staffId };
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  ctx.setNow(new Date('2026-06-01T06:00:00Z'));
  await ctx.flush();
  await Promise.all([
    ctx.deps.col.appointments.deleteMany({}),
    ctx.deps.col.calendarConnections.deleteMany({}),
    ctx.deps.col.calendarSync.deleteMany({}),
  ]);
  google = new FakeGoogle();
  icloud = new FakeICloud();
  setCalendarFetch(ctx.deps, (input, init) => (new URL(String(input)).host.endsWith('icloud.com') ? icloud.fetch(input, init) : google.fetch(input, init)));
});

// ── Tests ────────────────────────────────────────────────────────────────────────────────

describe('stored credentials', () => {
  const config = (...secrets: string[]) => ({ credentialSecrets: secrets.map((s) => new TextEncoder().encode(s)) });
  const key = (name: string) => `${name}-`.padEnd(48, 'k');

  it('are sealed with AES-256-GCM, bound to their row, and still open after a key rotation', async () => {
    const sealed = await sealSecret(config(key('current')), 'refresh-token-1', 'google:abc');
    expect(sealed).toMatch(/^v1\.[\w-]{8}\.[\w-]{16}\.[\w-]+$/);
    expect(sealed).not.toContain('refresh-token-1');
    // A new IV every time.
    expect(await sealSecret(config(key('current')), 'refresh-token-1', 'google:abc')).not.toBe(sealed);
    expect(await openSecret(config(key('current')), sealed, 'google:abc')).toBe('refresh-token-1');
    // Copied onto another connection, tampered with, or without its key: it does not open.
    expect(await openSecret(config(key('current')), sealed, 'google:other')).toBeNull();
    const [v, id, iv, data] = sealed.split('.');
    const flipped = `${data!.slice(0, -2)}${data!.at(-2) === 'A' ? 'B' : 'A'}${data!.at(-1)}`;
    expect(await openSecret(config(key('current')), [v, id, iv, flipped].join('.'), 'google:abc')).toBeNull();
    expect(await openSecret(config(key('another')), sealed, 'google:abc')).toBeNull();
    expect(await openSecret(config(key('current')), 'not-sealed', 'google:abc')).toBeNull();
    // A new CALENDAR_SYNC_KEY in front: what the old key sealed still opens.
    expect(await openSecret(config(key('newer'), key('current')), sealed, 'google:abc')).toBe('refresh-token-1');
  });
});

describe('Google Calendar', () => {
  it('connects through the sign-in redirect URI, with a state only the browser that asked can use', async () => {
    const earlier = await book();
    const { start, location } = await connectGoogle();
    const consent = new URL(start.body.url);
    expect(consent.origin + consent.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = consent.searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('redirect_uri')).toBe(`${APP_ORIGIN}/api/auth/google/callback`);
    expect(q.get('scope')).toBe(`openid email ${GOOGLE_CALENDAR_SCOPE}`);
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('prompt')).toContain('consent');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toMatch(/^cal\.[\w-]{32}$/);
    const cookie = start.setCookies.find((line) => line.startsWith('nba_oa='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/i);

    expect(location).toBe(`${APP_ORIGIN}/admin/schedule?calendar=google_connected`);
    expect(google.exchanges[0]?.get('code_verifier')).toMatch(/^[\w-]{64}$/);
    expect(google.exchanges[0]?.get('redirect_uri')).toBe(`${APP_ORIGIN}/api/auth/google/callback`);

    const status = (await owner.get('/api/admin/team/me/calendar')).body;
    expect(status.google).toEqual({ available: true, connected: true, needsReconnect: false, email: 'alina.master@gmail.com', lastSyncAt: expect.any(String) });
    expect(JSON.stringify(status)).not.toContain('refresh-alina');

    // The refresh token is kept sealed.
    const conn = await ctx.deps.col.calendarConnections.findOne({ provider: 'google' });
    expect(conn!.secret).not.toContain('refresh-alina');
    expect(await openSecret(ctx.deps.config, conn!.secret, conn!._id)).toBe('refresh-alina');
    expect(await ctx.deps.col.auditLogs.countDocuments({ action: 'calendar_sync.google_connect' })).toBe(1);

    // A calendar of the studio's own, with the bookings already made.
    expect(google.studio.calendar).toMatchObject({ summary: 'Nails by Alynna', timeZone: 'Europe/Chisinau' });
    expect(google.studio.events.map((e) => e.id)).toEqual([earlier.id]);
  });

  it('refuses answers that did not start in this browser, and says when Google was cancelled', async () => {
    // Another browser (no cookie) replaying a state.
    const start = await owner.post('/api/admin/team/me/calendar/google');
    const state = new URL(start.body.url).searchParams.get('state')!;
    const stranger = ctx.client({ origin: null });
    const replay = await stranger.get(`/api/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`);
    expect(replay.headers.get('location')).toBe(`${APP_ORIGIN}/admin/schedule?calendar=google_failed`);
    // This browser, a state that isn't the one it was given.
    const wrong = await owner.get(`/api/auth/google/callback?code=google-code&state=cal.${'x'.repeat(32)}`);
    expect(wrong.headers.get('location')).toBe(`${APP_ORIGIN}/admin/schedule?calendar=google_failed`);
    expect(google.exchanges).toHaveLength(0);

    await owner.post('/api/admin/team/me/calendar/google');
    const cancelled = await owner.get(`/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    expect(cancelled.headers.get('location')).toBe(`${APP_ORIGIN}/admin/schedule?calendar=google_cancelled`);

    // The calendar permission unticked on Google's screen.
    google.scope = 'openid https://www.googleapis.com/auth/userinfo.email';
    expect((await connectGoogle()).location).toBe(`${APP_ORIGIN}/admin/schedule?calendar=google_scope`);
    expect(await ctx.deps.col.calendarConnections.countDocuments({})).toBe(0);
  });

  it('writes each booking the moment it is made, confirmed, moved and cancelled', async () => {
    await connectGoogle();
    const { client, id, code } = await book({ notes: 'Pastel, please' });
    await ctx.flush();
    let [event] = google.studio.events;
    expect(event).toMatchObject({ id, status: 'tentative' });
    expect(event!.summary).toMatch(/^Cerere: Ana Rusu · /);
    expect(event!.description).toContain(`Cod programare: ${code}`);
    expect(event!.description).toContain('Nota clientei: Pastel, please');
    expect(event!.description).toContain(`${APP_ORIGIN}/admin/appointments/${id}`);
    // Never the client's phone.
    expect(JSON.stringify(event)).not.toMatch(/069 123 456|\+373/);

    expect((await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed' })).status).toBe(200);
    await ctx.flush();
    [event] = google.studio.events;
    expect(event).toMatchObject({ id, status: 'confirmed' });
    expect(event!.summary).toMatch(/^Ana Rusu · /);

    const slots = (await client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-04&staffId=${alinaId.toHexString()}`)).body.slots;
    expect((await client.post(`/api/appointments/${id}/reschedule`, { start: slots[1].start, staffId: alinaId.toHexString() })).status).toBe(200);
    await ctx.flush();
    [event] = google.studio.events;
    expect(new Date(event!.start.dateTime).toISOString()).toBe(slots[1].start);

    expect((await client.post(`/api/appointments/${id}/cancel`, {})).status).toBe(200);
    await ctx.flush();
    expect(google.studio.events).toEqual([]);
    expect(await rowsOf(id)).toMatchObject([{ status: 'synced', remote: false }]);
  });

  it('asks the master to connect again when Google access is removed, and catches up after', async () => {
    await connectGoogle();
    google.accessRemoved = true;
    const { id } = await book();
    await ctx.flush();
    expect((await owner.get('/api/admin/team/me/calendar')).body.google).toMatchObject({ connected: true, needsReconnect: true });
    expect(await rowsOf(id)).toMatchObject([{ status: 'pending', remote: false }]);

    // Nothing more is tried meanwhile.
    const before = google.requests.length;
    await runCalendarSync(ctx.deps);
    expect(google.requests.length).toBe(before);

    // Connected again (same account): the same calendar, and the booking is written.
    google.accessRemoved = false;
    const calendarsBefore = google.calendars.size;
    expect((await connectGoogle()).location).toBe(`${APP_ORIGIN}/admin/schedule?calendar=google_connected`);
    expect(google.calendars.size).toBe(calendarsBefore);
    expect(google.studio.events.map((e) => e.id)).toEqual([id]);
    expect((await owner.get('/api/admin/team/me/calendar')).body.google.needsReconnect).toBe(false);
  });

  it('tries again later when Google is busy, and makes the calendar again if it was deleted', async () => {
    await connectGoogle();
    google.failures.push({ match: /^PUT \/calendar\/v3\/calendars\/.+\/events\//, status: 503 });
    const { id } = await book();
    await ctx.flush();
    const [failed] = await rowsOf(id);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
    expect(failed!.retryAt!.getTime()).toBe(ctx.now().getTime() + MINUTE);
    // Not before its time; then it goes.
    await runCalendarSync(ctx.deps);
    expect(google.studio.events).toEqual([]);
    ctx.advance(MINUTE);
    await runCalendarSync(ctx.deps);
    expect(google.studio.events.map((e) => e.id)).toEqual([id]);

    // Rate limited: waits as long as Google says.
    google.failures.push({ match: /^PUT /, status: 429, headers: { 'Retry-After': '120' } });
    await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed' });
    await ctx.flush();
    expect((await rowsOf(id))[0]!.retryAt!.getTime()).toBe(ctx.now().getTime() + 120_000);
    ctx.advance(120_000);
    await runCalendarSync(ctx.deps);
    expect(google.studio.events[0]!.status).toBe('confirmed');

    // The master deleted the studio's calendar in Google: the next change makes it again, full.
    google.calendars.clear();
    const second = await book({ date: '2026-06-05' });
    await ctx.flush();
    expect(google.calendars.size).toBe(1);
    expect(google.studio.events.map((e) => e.id).sort()).toEqual([id, second.id].sort());
    const conn = await ctx.deps.col.calendarConnections.findOne({ provider: 'google' });
    expect(conn!.calendarId).toBe(google.studio.id);
  });

  it('compares everything every hour, and "Sync now" writes it all again', async () => {
    await connectGoogle();
    const { id } = await book();
    await ctx.flush();
    // A change the app didn't announce (made straight in the database).
    ctx.advance(MINUTE);
    await ctx.deps.col.appointments.updateOne({ _id: new ObjectId(id) }, { $set: { notes: 'Changed quietly', updatedAt: ctx.now() } });
    ctx.advance(29 * MINUTE);
    await runCalendarSync(ctx.deps);
    expect(google.studio.events[0]!.description).not.toContain('Changed quietly');
    ctx.advance(31 * MINUTE);
    await runCalendarSync(ctx.deps);
    expect(google.studio.events[0]!.description).toContain('Changed quietly');

    google.studio.calendar!.events.clear();
    // (An hour on, the owner signs in again.)
    const now = await (await loginAs(ctx, 'owner@example.com', strongPassword)).post('/api/admin/team/me/calendar/sync');
    expect(now.status).toBe(200);
    await ctx.flush();
    expect(google.studio.events.map((e) => e.id)).toEqual([id]);
  });

  it('disconnects: the calendar is deleted in Google, the token given back, nothing kept', async () => {
    await connectGoogle();
    const { id } = await book();
    await ctx.flush();
    const res = await owner.delete('/api/admin/team/me/calendar/google');
    expect(res.status).toBe(200);
    expect(res.body.google).toMatchObject({ connected: false, email: null });
    await ctx.flush();
    expect(google.calendars.size).toBe(0);
    expect(google.revoked).toEqual(['refresh-alina']);
    expect(await ctx.deps.col.calendarConnections.countDocuments({})).toBe(0);
    expect(await rowsOf(id)).toEqual([]);
    expect(await ctx.deps.col.auditLogs.countDocuments({ action: 'calendar_sync.google_disconnect' })).toBe(1);
    // Later changes go nowhere.
    await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed' });
    await ctx.flush();
    expect(google.calendars.size).toBe(0);
  });
});

describe('Apple Calendar (iCloud)', () => {
  it('checks the Apple ID and app-specific password, then makes the studio calendar and fills it', async () => {
    const earlier = await book();
    const wrong = await connectApple(owner, { password: 'wrong-pass-word-here' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toMatchObject({ code: 'CALENDAR_AUTH', fields: { password: 'apple_auth' } });
    expect(await ctx.deps.col.calendarConnections.countDocuments({})).toBe(0);

    // Spaces as Apple shows it are fine.
    const res = await connectApple(owner, { appleId: ' Alina@iCloud.com ', password: 'abcd-efgh-ijkl-mnop ' });
    expect(res.status).toBe(201);
    expect(res.body.apple).toEqual({ connected: true, needsReconnect: false, appleId: 'al•••@icloud.com', lastSyncAt: null });
    expect(JSON.stringify(res.body)).not.toContain(icloud.password);
    const conn = await ctx.deps.col.calendarConnections.findOne({ provider: 'apple' });
    expect(conn!.secret).not.toContain(icloud.password);
    expect(await openSecret(ctx.deps.config, conn!.secret, conn!._id)).toBe(icloud.password);
    expect(conn!.homeUrl).toBe('https://p42-caldav.icloud.com/123456/calendars/');

    expect(icloud.studio.calendar?.name).toBe('Nails by Alynna');
    expect(icloud.studio.events.map(([name]) => name)).toEqual([`${earlier.id}.ics`]);
    const ics = unfold(icloud.studio.events[0]![1]);
    expect(ics).toContain(`UID:${earlier.id}@nails-by-alynna`);
    expect(ics).toMatch(/SUMMARY:Cerere: Ana Rusu · /);
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).toMatch(/SEQUENCE:\d+/);
    // A calendar object, not a feed: no METHOD (RFC 4791).
    expect(ics).not.toContain('METHOD:');
    expect(await ctx.deps.col.auditLogs.countDocuments({ action: 'calendar_sync.apple_connect' })).toBe(1);

    // Connected again: the same calendar, not a second one.
    await connectApple(owner);
    expect(icloud.calendars.size).toBe(2);
    expect(icloud.requests.filter((r) => r.startsWith('MKCALENDAR'))).toHaveLength(1);
  });

  it('keeps writing on every change, and removes the event when the booking is cancelled', async () => {
    await connectApple(owner);
    const { client, id } = await book();
    await ctx.flush();
    expect(icloud.studio.events.map(([name]) => name)).toEqual([`${id}.ics`]);
    await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed' });
    await ctx.flush();
    expect(unfold(icloud.studio.events[0]![1])).toContain('STATUS:CONFIRMED');
    await client.post(`/api/appointments/${id}/cancel`, {});
    await ctx.flush();
    expect(icloud.studio.events).toEqual([]);
  });

  it('never sends the password anywhere but iCloud', async () => {
    icloud.homeSet = 'https://calendars.example.com/123456/calendars/';
    const res = await connectApple(owner);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('CALENDAR_UNREACHABLE');
    expect(icloud.requests.every((r) => /^\w+ [\w.-]*icloud\.com/.test(r))).toBe(true);
  });

  it('asks to connect again when the app-specific password stops working, and tells the master once', async () => {
    const pushed: Array<Record<string, unknown>> = [];
    setPushTransport(ctx.deps, {
      async send(_target, payload) {
        pushed.push(JSON.parse(payload) as Record<string, unknown>);
        return 201;
      },
    });
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    expect((await owner.post('/api/notifications/push/subscribe', { endpoint: 'https://web.push.apple.com/owner-phone', keys })).status).toBe(200);
    try {
      await connectApple(owner);
      icloud.password = 'revoked-by-the-master';
      const { id } = await book();
      await ctx.flush();
      await book({ date: '2026-06-04' });
      await ctx.flush();
      expect((await owner.get('/api/admin/team/me/calendar')).body.apple).toMatchObject({ connected: true, needsReconnect: true });
      expect(await rowsOf(id)).toMatchObject([{ status: 'pending' }]);
      const told = pushed.filter((p) => p.title === 'Calendarul nu se mai actualizează');
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ url: `${APP_ORIGIN}/admin/schedule` });
    } finally {
      setPushTransport(ctx.deps, null);
      await ctx.deps.col.pushSubscriptions.deleteMany({});
    }
    const [id] = (await ctx.deps.col.appointments.find({}).sort({ start: 1 }).toArray()).map((a) => a._id.toHexString());

    await connectApple(owner, { password: 'revoked-by-the-master' });
    expect((await owner.get('/api/admin/team/me/calendar')).body.apple.needsReconnect).toBe(false);
    expect(icloud.studio.events.map(([name]) => name)).toHaveLength(2);
    expect(icloud.studio.events.map(([name]) => name)).toContain(`${id}.ics`);
  });

  it('disconnects: the studio calendar is deleted in iCloud', async () => {
    await connectApple(owner);
    await book();
    await ctx.flush();
    const res = await owner.delete('/api/admin/team/me/calendar/apple');
    expect(res.body.apple).toMatchObject({ connected: false, appleId: null });
    await ctx.flush();
    expect(icloud.studio.path).toBeUndefined();
    expect([...icloud.calendars.keys()]).toEqual(['/123456/calendars/home/']);
    expect(await ctx.deps.col.calendarSync.countDocuments({})).toBe(0);
  });
});

describe('a booking given to another master', () => {
  it('leaves the first master calendar and appears in the new one', async () => {
    await connectGoogle();
    icloud.appleId = 'irina@icloud.com';
    expect((await connectApple(irina.client)).status).toBe(201);
    const { id, start } = await book();
    await ctx.flush();
    expect(google.studio.events.map((e) => e.id)).toEqual([id]);
    expect(icloud.studio.events).toEqual([]);

    const moved = await owner.post(`/api/admin/appointments/${id}/reschedule`, { start, staffId: irina.staffId.toHexString(), force: true });
    expect(moved.status).toBe(200);
    await ctx.flush();
    expect(google.studio.events).toEqual([]);
    expect(icloud.studio.events.map(([name]) => name)).toEqual([`${id}.ics`]);
  });
});

describe('who can connect', () => {
  it('only a master, for their own profile; never another master', async () => {
    const { client } = await registerClient(ctx);
    for (const [method, path] of [
      ['POST', '/api/admin/team/me/calendar/google'],
      ['POST', '/api/admin/team/me/calendar/apple'],
      ['POST', '/api/admin/team/me/calendar/sync'],
      ['DELETE', '/api/admin/team/me/calendar/google'],
    ] as const) {
      expect((await client.request(method, path, method === 'POST' ? {} : undefined)).status).toBe(403);
      expect((await ctx.client().request(method, path, method === 'POST' ? {} : undefined)).status).toBe(401);
    }
    // Staff without a master profile have no calendar to connect.
    const desk = await registerClient(ctx);
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(desk.user.id) }, { $set: { role: 'admin' } });
    expect((await desk.client.post('/api/admin/team/me/calendar/google')).status).toBe(404);

    // Irina connecting writes Irina's calendar, never Alina's.
    icloud.appleId = 'irina@icloud.com';
    await connectApple(irina.client);
    const conn = await ctx.deps.col.calendarConnections.findOne({ provider: 'apple' });
    expect(conn!.staffId.equals(irina.staffId)).toBe(true);
    expect((await owner.get('/api/admin/team/me/calendar')).body.apple.connected).toBe(false);

    // Google not set up on the server: said plainly.
    const plain = await createTestContext();
    try {
      await plain.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
      const plainOwner = await loginAs(plain, 'owner@example.com', strongPassword);
      expect((await plainOwner.get('/api/admin/team/me/calendar')).body.google.available).toBe(false);
      expect((await plainOwner.post('/api/admin/team/me/calendar/google')).body.error.code).toBe('CALENDAR_UNAVAILABLE');
    } finally {
      await plain.close();
    }
  });
});
