import { ObjectId } from 'bson';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import type { AppointmentDoc } from '../src/db/types';
import { appointmentReminderEmail, verificationCodeEmail } from '../src/lib/emails';
import { EMAILJS_ENDPOINT, MailError, createMailer, isUndeliverableAddress } from '../src/lib/mailer';
import { setPushTransport, type PushSendOptions, type PushTarget } from '../src/lib/push';
import { notifyBookingChange, runDueNotifications } from '../src/modules/notifications';
import { isAllowedPushEndpoint } from '../src/modules/notifications/routes';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

const CRON_SECRET = 'cron-secret-for-tests-'.padEnd(40, 'z');
const START = new Date('2026-06-01T06:00:00Z'); // Monday 09:00 in Chișinău
const MIN = 60_000;
const HOUR = 60 * MIN;

let ctx: TestContext;
let staffId: ObjectId;

beforeAll(async () => {
  ctx = await createTestContext({ CRON_SECRET });
  await ctx.seed();
  staffId = (await ctx.deps.col.staff.findOne({}))!._id;
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  ctx.setNow(START);
  setPushTransport(ctx.deps, null);
  vi.unstubAllGlobals();
});

/** A visit written straight to the database (the booking rules are tested elsewhere). */
async function visit(clientId: string, start: Date, extra: Partial<AppointmentDoc> = {}): Promise<AppointmentDoc> {
  const now = ctx.now();
  const doc: AppointmentDoc = {
    _id: new ObjectId(),
    code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    clientId: new ObjectId(clientId),
    client: { name: 'Ana', surname: 'Rusu', phone: null, email: 'snapshot@example.com' },
    staffId,
    services: [{ serviceId: new ObjectId(), name: { ro: 'Gel lac', ru: 'Гель-лак', en: 'Gel polish' }, durationMin: 60, price: 300, priceFrom: false }],
    start,
    end: new Date(start.getTime() + HOUR),
    durationMin: 60,
    totalPrice: 300,
    priceFrom: false,
    status: 'confirmed',
    notes: '',
    staffNotes: '',
    source: 'client',
    placedAt: now,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: '',
    createdBy: new ObjectId(clientId),
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  await ctx.deps.col.appointments.insertOne(doc);
  return doc;
}

const mailsTo = (email: string) => ctx.sentMail.filter((m) => m.to === email);

async function client(prefs?: Record<string, unknown>) {
  const registered = await registerClient(ctx);
  if (prefs) expect((await registered.client.patch('/api/notifications/prefs', prefs)).status).toBe(200);
  await ctx.flush();
  return { ...registered, sentBefore: mailsTo(registered.user.email).length };
}

describe('notification preferences', () => {
  it('start with reminders and booking updates on, and news off', async () => {
    const { client: c, user } = await registerClient(ctx);
    const res = await c.get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      prefs: {
        reminders: { enabled: true, leadMinutes: [60], email: true, push: true },
        bookingUpdates: { email: true, push: true },
        // Only staff see this one in Settings; it tells them about clients' bookings.
        staffBookings: { email: true, push: true },
        loyalty: { email: false, push: true },
        marketing: { email: false, push: false, consentAt: null },
      },
      email: { address: user.email, available: true },
      push: { available: false, publicKey: null, devices: 0 },
    });
  });

  it('save partial changes, validate lead times and date consent to news', async () => {
    const { client: c, user } = await registerClient(ctx);
    const leads = await c.patch('/api/notifications/prefs', { reminders: { leadMinutes: [1440, 60, 60] } });
    expect(leads.body.prefs.reminders).toEqual({ enabled: true, leadMinutes: [60, 1440], email: true, push: true });
    expect((await c.patch('/api/notifications/prefs', { reminders: { leadMinutes: [30] } })).status).toBe(422);
    expect((await c.patch('/api/notifications/prefs', { reminders: { leadMinutes: [] } })).status).toBe(422);

    const optIn = await c.patch('/api/notifications/prefs', { marketing: { email: true } });
    expect(optIn.body.prefs.marketing).toEqual({ email: true, push: false, consentAt: START.toISOString() });
    const optOut = await c.patch('/api/notifications/prefs', { marketing: { email: false } });
    expect(optOut.body.prefs.marketing.consentAt).toBeNull();
    const trail = await ctx.deps.col.auditLogs.find({ action: 'user.marketing_consent', targetId: user.id }).toArray();
    expect(trail.map((e) => e.meta)).toEqual([{ email: true, push: false }, { email: false, push: false }]);

    // Everything else kept its value.
    expect((await c.get('/api/notifications')).body.prefs.reminders.leadMinutes).toEqual([60, 1440]);
  });
});

describe('reminders', () => {
  it('go out once, when the chosen time before the visit has come, in the client language', async () => {
    const { user, sentBefore } = await client();
    const appt = await visit(user.id, new Date(START.getTime() + 3 * HOUR)); // 12:00 local

    await runDueNotifications(ctx.deps);
    expect(mailsTo(user.email)).toHaveLength(sentBefore);

    ctx.setNow(new Date(appt.start.getTime() - 59 * MIN));
    const first = await runDueNotifications(ctx.deps);
    expect(first).toMatchObject({ sent: 1, failed: 0 });
    const mail = mailsTo(user.email).at(-1)!;
    expect(mail.subject).toBe('Memento: vizita ta de azi, la 12:00');
    expect(mail.html).toContain('Gel lac');
    expect(mail.html).toContain(`/bookings/${appt._id.toHexString()}`);
    expect(mail.text).toContain(appt.code);

    const second = await runDueNotifications(ctx.deps);
    expect(second.sent).toBe(0);
    expect(second.duplicates).toBeGreaterThanOrEqual(1);
    expect(mailsTo(user.email)).toHaveLength(sentBefore + 1);
    const log = await ctx.deps.col.notificationLog.findOne({ _id: `reminder:${appt._id.toHexString()}:${appt.start.getTime()}:60` });
    expect(log).toMatchObject({ status: 'sent', channels: { email: 'sent', push: 'off' } });
  });

  it('follow each lead time, skip the moments before the booking, and send only the closest after downtime', async () => {
    const { user, sentBefore } = await client({ reminders: { leadMinutes: [60, 1440] } });
    const start = new Date(START.getTime() + 2 * 24 * HOUR); // Wednesday 09:00
    await visit(user.id, start);

    ctx.setNow(new Date(start.getTime() - 24 * HOUR + MIN));
    expect((await runDueNotifications(ctx.deps)).sent).toBe(1);
    expect(mailsTo(user.email).at(-1)!.subject).toBe('Memento: vizita ta de mâine, la 09:00');
    ctx.setNow(new Date(start.getTime() - HOUR + MIN));
    expect((await runDueNotifications(ctx.deps)).sent).toBe(1);
    expect(mailsTo(user.email)).toHaveLength(sentBefore + 2);

    // Booked 3 hours ahead: the "1 day before" moment had already passed, so only 1 hour before.
    ctx.setNow(START);
    const lateStart = new Date(START.getTime() + 3 * HOUR);
    await visit(user.id, lateStart);
    ctx.setNow(new Date(lateStart.getTime() - HOUR + MIN));
    expect((await runDueNotifications(ctx.deps)).sent).toBe(1);

    // After downtime both moments have passed: one message, the closer one.
    ctx.setNow(START);
    const missed = await visit(user.id, new Date(START.getTime() + 3 * 24 * HOUR));
    ctx.setNow(new Date(missed.start.getTime() - 30 * MIN));
    const before = mailsTo(user.email).length;
    expect((await runDueNotifications(ctx.deps)).sent).toBe(1);
    expect(mailsTo(user.email)).toHaveLength(before + 1);
    const covered = await ctx.deps.col.notificationLog.findOne({ _id: `reminder:${missed._id.toHexString()}:${missed.start.getTime()}:1440` });
    expect(covered?.status).toBe('skipped');
    expect((await runDueNotifications(ctx.deps)).sent).toBe(0);
  });

  it('follow the preferences, and a reminder switched on later still goes out while it is due', async () => {
    const { client: c, user, sentBefore } = await client({ reminders: { email: false } });
    const appt = await visit(user.id, new Date(START.getTime() + 2 * HOUR));
    ctx.setNow(new Date(appt.start.getTime() - 50 * MIN));
    expect((await runDueNotifications(ctx.deps)).sent).toBe(0);

    // (An hour later the 15-minute access token has expired; the app refreshes silently.)
    expect((await c.post('/api/auth/refresh')).status).toBe(200);
    expect((await c.patch('/api/notifications/prefs', { reminders: { email: true } })).status).toBe(200);
    expect((await runDueNotifications(ctx.deps)).sent).toBe(1);
    expect(mailsTo(user.email)).toHaveLength(sentBefore + 1);

    const { client: quiet, user: quietUser, sentBefore: quietBefore } = await client({ reminders: { enabled: false } });
    await visit(quietUser.id, new Date(ctx.now().getTime() + 30 * MIN));
    await runDueNotifications(ctx.deps);
    expect(mailsTo(quietUser.email)).toHaveLength(quietBefore);
    expect((await quiet.get('/api/notifications')).body.prefs.reminders.enabled).toBe(false);
  });

  it('skip cancelled visits, demo accounts and moved visits until their new time', async () => {
    const { user, sentBefore } = await client();
    const cancelled = await visit(user.id, new Date(START.getTime() + 2 * HOUR), { status: 'cancelled', cancelledBy: 'client', cancelledAt: START });
    const demo = await client();
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(demo.user.id) }, { $set: { isDemo: true } });
    await visit(demo.user.id, cancelled.start);
    ctx.setNow(new Date(cancelled.start.getTime() - 30 * MIN));
    await runDueNotifications(ctx.deps);
    expect(mailsTo(user.email)).toHaveLength(sentBefore);
    expect(mailsTo(demo.user.email)).toHaveLength(demo.sentBefore);

    // Moved after its reminder went out: the new time gets its own reminder.
    ctx.setNow(START);
    const moved = await visit(user.id, new Date(START.getTime() + 2 * HOUR));
    ctx.setNow(new Date(moved.start.getTime() - 50 * MIN));
    expect((await runDueNotifications(ctx.deps)).sent).toBe(1);
    const newStart = new Date(moved.start.getTime() + 3 * HOUR);
    await ctx.deps.col.appointments.updateOne({ _id: moved._id }, { $set: { start: newStart, placedAt: ctx.now() } });
    ctx.setNow(new Date(newStart.getTime() - 55 * MIN));
    expect((await runDueNotifications(ctx.deps)).sent).toBe(1);
  });

  it('reach walk-in clients the studio booked, without links that need an account', async () => {
    const now = ctx.now();
    const walkIn = new ObjectId();
    await ctx.deps.col.users.insertOne({
      _id: walkIn,
      email: 'walk.in@gmail.com',
      name: 'Elena',
      surname: 'Rusu',
      phone: '+37369000111',
      role: 'client',
      locale: 'en',
      passwordHash: null,
      googleId: null,
      isActive: true,
      bookingBlocked: false,
      tokenVersion: 0,
      notes: '',
      search: '',
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const appt = await visit(walkIn.toHexString(), new Date(START.getTime() + 2 * HOUR), { source: 'staff' });
    ctx.setNow(new Date(appt.start.getTime() - 55 * MIN));
    await runDueNotifications(ctx.deps);
    const mail = mailsTo('walk.in@gmail.com').at(-1)!;
    expect(mail.subject).toBe('Reminder: your visit today at 11:00');
    expect(mail.html).not.toContain('/bookings/');
    expect(mail.html).not.toContain('/profile/notifications');
    expect(mail.text).toContain('you have a booking at Nails by Alynna');
  });

  it('can be triggered by an external cron with the secret header only', async () => {
    const plain = ctx.client({ origin: null });
    expect((await plain.post('/api/internal/tick')).status).toBe(404);
    expect((await plain.post('/api/internal/tick', undefined, { 'x-nba-cron-key': 'wrong' })).status).toBe(404);
    const ok = await plain.post('/api/internal/tick', undefined, { 'x-nba-cron-key': CRON_SECRET });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, sent: expect.any(Number), checked: expect.any(Number) });
  });
});

describe('Web Push', () => {
  const pushed: Array<{ target: PushTarget; payload: Record<string, string>; options: PushSendOptions }> = [];
  function fakePush() {
    pushed.length = 0;
    setPushTransport(ctx.deps, {
      async send(target, payload, options) {
        pushed.push({ target, payload: JSON.parse(payload) as Record<string, string>, options });
        return target.endpoint.includes('/gone') ? 410 : 201;
      },
    });
  }
  const sub = (id: string) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  });

  it('accept subscriptions only from real push services', async () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGuQyavXutnMH')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://evil.example.com/fcm.googleapis.com')).toBe(false);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false);

    const { client: c } = await registerClient(ctx);
    expect((await c.post('/api/notifications/push/subscribe', sub('a'))).body.error.code).toBe('PUSH_UNAVAILABLE');
    fakePush();
    expect((await c.post('/api/notifications/push/subscribe', { ...sub('b'), endpoint: 'https://127.0.0.1/x' })).status).toBe(422);
    expect((await c.post('/api/notifications/push/subscribe', sub('b'))).status).toBe(200);
  });

  it('reach signed-in devices, forget subscriptions the push service dropped (410) and signed-out devices', async () => {
    fakePush();
    const { client: phone, user } = await registerClient(ctx);
    expect((await phone.post('/api/notifications/push/subscribe', sub(`ok-${user.id}`))).status).toBe(200);
    expect((await phone.post('/api/notifications/push/subscribe', sub(`gone-${user.id}`))).status).toBe(200);
    const userId = new ObjectId(user.id);
    expect(await ctx.deps.col.pushSubscriptions.countDocuments({ userId })).toBe(2);

    const test = await phone.post('/api/notifications/push/test');
    expect(test.body).toEqual({ sent: 1, devices: 2 });
    expect(pushed.map((p) => p.payload.title)).toContain('Notificările sunt pornite');
    expect(await ctx.deps.col.pushSubscriptions.countDocuments({ userId })).toBe(1);

    // A reminder by push too (email off), with the booking link and a tag per visit.
    await phone.patch('/api/notifications/prefs', { reminders: { email: false } });
    const appt = await visit(user.id, new Date(START.getTime() + 2 * HOUR));
    ctx.setNow(new Date(appt.start.getTime() - 50 * MIN));
    pushed.length = 0;
    expect((await runDueNotifications(ctx.deps)).sent).toBe(1);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.payload).toMatchObject({
      title: 'Vizita ta, azi la 11:00',
      url: `/bookings/${appt._id.toHexString()}`,
      tag: `visit-${appt._id.toHexString()}`,
    });
    expect(pushed[0]!.options).toMatchObject({ urgency: 'high' });

    // Signing out on that phone stops its notifications.
    ctx.setNow(START);
    await phone.post('/api/auth/logout');
    const laptop = await loginAs(ctx, user.email, strongPassword);
    expect((await laptop.post('/api/notifications/push/test')).body).toEqual({ sent: 0, devices: 0 });
    expect(await ctx.deps.col.pushSubscriptions.countDocuments({ userId })).toBe(0);
  });
});

describe('booking updates from the studio', () => {
  let c: TestClient;
  let user: { id: string; email: string };
  let sentBefore = 0;
  beforeAll(async () => {
    ({ client: c, user, sentBefore } = await client());
  });

  it('announce a confirmation, a new time and a cancellation, each once', async () => {
    const appt = await visit(user.id, new Date(START.getTime() + 26 * HOUR), { status: 'confirmed' });
    expect(await notifyBookingChange(ctx.deps, appt._id, 'confirmed')).toBe('sent');
    expect(await notifyBookingChange(ctx.deps, appt._id.toHexString(), 'confirmed')).toBe('duplicate');
    expect(mailsTo(user.email).at(-1)!.subject).toBe('Programarea ta este confirmată: mâine, la 11:00');

    await ctx.deps.col.appointments.updateOne({ _id: appt._id }, { $set: { start: new Date(appt.start.getTime() + HOUR) } });
    expect(await notifyBookingChange(ctx.deps, appt._id, 'rescheduled')).toBe('sent');
    expect(mailsTo(user.email).at(-1)!.subject).toBe('Vizita ta a fost mutată: mâine, la 12:00');

    await ctx.deps.col.appointments.updateOne(
      { _id: appt._id },
      { $set: { status: 'cancelled', cancelledBy: 'staff', cancelledAt: ctx.now() } },
    );
    expect(await notifyBookingChange(ctx.deps, appt._id, 'cancelled')).toBe('sent');
    const cancelled = mailsTo(user.email).at(-1)!;
    expect(cancelled.subject).toBe('Vizita ta de mâine a fost anulată');
    expect(cancelled.text).toContain('/book');
    expect(mailsTo(user.email)).toHaveLength(sentBefore + 3);
  });

  it('stay quiet for the client own cancellations, mismatched statuses, past visits and when switched off', async () => {
    const own = await visit(user.id, new Date(START.getTime() + 5 * HOUR), { status: 'cancelled', cancelledBy: 'client', cancelledAt: START });
    expect(await notifyBookingChange(ctx.deps, own._id, 'cancelled')).toBe('skipped');
    const pending = await visit(user.id, new Date(START.getTime() + 6 * HOUR), { status: 'pending' });
    expect(await notifyBookingChange(ctx.deps, pending._id, 'confirmed')).toBe('skipped');
    const past = await visit(user.id, new Date(START.getTime() - HOUR));
    expect(await notifyBookingChange(ctx.deps, past._id, 'rescheduled')).toBe('skipped');
    expect(await notifyBookingChange(ctx.deps, 'not-an-id', 'confirmed')).toBe('skipped');

    await c.patch('/api/notifications/prefs', { bookingUpdates: { email: false, push: false } });
    const later = await visit(user.id, new Date(START.getTime() + 30 * HOUR));
    expect(await notifyBookingChange(ctx.deps, later._id, 'confirmed')).toBe('skipped');
  });
});

describe('email delivery', () => {
  const emailJsEnv = {
    APP_ENV: 'test',
    DATABASE_URL: 'postgres://127.0.0.1:5432/nails_by_alynna',
    JWT_SECRET: 'x'.repeat(48),
    EMAILJS_SERVICE_ID: 'service_test',
    EMAILJS_TEMPLATE_ID: 'template_test',
    EMAILJS_PUBLIC_KEY: 'public_test',
  };

  it('posts the EmailJS request the dashboard template expects', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('OK', { status: 200 });
    });
    const config = loadConfig({ ...emailJsEnv, EMAILJS_PRIVATE_KEY: 'private_test', RESEND_API_KEY: 're_x', MAIL_FROM: 'a@b.md' });
    expect(config.mail?.provider).toBe('emailjs');
    const mailer = createMailer(config);
    await mailer.send({ to: 'ana@gmail.com', toName: 'Ana', subject: 'Subject', html: '<p>Hi</p>', text: 'Hi', replyTo: 'studio@gmail.com' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(EMAILJS_ENDPOINT);
    expect(calls[0]!.init.method).toBe('POST');
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBe('application/json');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      service_id: 'service_test',
      template_id: 'template_test',
      user_id: 'public_test',
      accessToken: 'private_test',
      template_params: {
        to_email: 'ana@gmail.com',
        to_name: 'Ana',
        subject: 'Subject',
        html: '<p>Hi</p>',
        text: 'Hi',
        reply_to: 'studio@gmail.com',
      },
    });

    // Placeholders and reserved test domains never reach the provider.
    await mailer.send({ to: `client+${new ObjectId().toHexString()}@no-email.invalid`, subject: 's', html: 'h', text: 't' });
    await mailer.send({ to: 'maria.popescu@example.com', subject: 's', html: 'h', text: 't' });
    expect(calls).toHaveLength(1);
  });

  it('reports the provider answer (status and body), e.g. the 403 for server calls', async () => {
    vi.stubGlobal('fetch', async () => new Response('API calls are disabled for non-browser applications', { status: 403 }));
    const mailer = createMailer(loadConfig(emailJsEnv));
    const error = await mailer.send({ to: 'ana@gmail.com', subject: 's', html: 'h', text: 't' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailError);
    expect(error).toMatchObject({ status: 403, body: 'API calls are disabled for non-browser applications', transient: false });
    // A rejected setup counts as broken (code requests say so) until a message goes through.
    expect(mailer.working?.()).toBe(false);
    vi.stubGlobal('fetch', async () => new Response('OK', { status: 200 }));
    await mailer.send({ to: 'ana@gmail.com', subject: 's', html: 'h', text: 't' });
    expect(mailer.working?.()).toBe(true);
  });

  it('refuses half an EmailJS setup and knows undeliverable addresses', () => {
    expect(() => loadConfig({ ...emailJsEnv, EMAILJS_PUBLIC_KEY: '' })).toThrow(/EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID and EMAILJS_PUBLIC_KEY/);
    expect(() => loadConfig({ ...emailJsEnv, VAPID_PUBLIC_KEY: 'x' })).toThrow(/VAPID/);
    expect(() => loadConfig({ ...emailJsEnv, VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y' })).toThrow(/VAPID_SUBJECT/);
    expect(isUndeliverableAddress('ana@gmail.com')).toBe(false);
    for (const address of ['a@example.com', 'a@mail.example.org', 'a@studio.test', 'deleted+1@invalid.local', 'x@localhost']) {
      expect(isUndeliverableAddress(address), address).toBe(true);
    }
  });

  it('escapes every value in the branded templates and drops unsafe links', () => {
    const hostile = '<script>alert(1)</script>';
    const mail = appointmentReminderEmail({
      to: 'ana@gmail.com',
      name: hostile,
      locale: 'en',
      timeZone: 'Europe/Chisinau',
      now: START,
      visit: {
        code: 'ABC123',
        start: new Date(START.getTime() + HOUR),
        status: 'pending',
        services: [`Gel ${hostile}`],
        master: 'Alina "the best"',
        address: 'str. Ștefan cel Mare 1, Chișinău',
        bookingUrl: 'javascript:alert(1)',
        directionsUrl: 'https://maps.app.goo.gl/x?a=1&b=2',
        bookUrl: 'https://app.example/book',
        settingsUrl: 'https://app.example/profile/notifications',
        changeDeadline: new Date(START.getTime() - HOUR),
        studioPhone: '+37368230429',
      },
    });
    expect(mail.subject).toBe('Reminder: your visit today at 10:00');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Alina &quot;the best&quot;');
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).toContain('https://maps.app.goo.gl/x?a=1&amp;b=2');
    expect(mail.html).toContain('prefers-color-scheme:dark');
    expect(mail.text).toContain("hasn't confirmed");
    expect(mail.text).toContain('+37368230429');

    const code = verificationCodeEmail({ to: 'a@gmail.com', name: 'Ana', locale: 'ro', code: '042917', purpose: 'verify_email' });
    expect(code.subject).toBe('Confirmă emailul: codul 042917');
    expect(code.html).toContain('042917');
    expect(code.text).toContain('042917');
  });
});
