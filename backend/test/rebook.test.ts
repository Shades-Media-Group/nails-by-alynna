import { ObjectId } from 'bson';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppointmentDoc } from '../src/db/types';
import { rebookEmail } from '../src/lib/emails';
import { setPushTransport, type PushSendOptions } from '../src/lib/push';
import { runDueNotifications } from '../src/modules/notifications';
import { dueStep, fillText, toneOf } from '../src/modules/notifications/rebook';
import { invalidateSettingsCache } from '../src/modules/settings';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * "Come back" reminders: a client whose last completed visit was weeks ago, with nothing booked
 * since, hears from the studio on a schedule the owner sets in Admin → Settings.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** The last visit ends on Monday 1 June at 12:00 in Chișinău (EEST, UTC+3). */
const LAST_END = new Date('2026-06-01T09:00:00Z');
const at = (days: number, ms = 0) => new Date(LAST_END.getTime() + days * DAY + ms);

let ctx: TestContext;
let owner: TestClient;
let staffId: ObjectId;
let gel: { id: ObjectId; name: { ro: string; ru: string; en: string } };

const pushed: Array<{ endpoint: string; payload: Record<string, string>; options: PushSendOptions }> = [];

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Olga', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  staffId = (await ctx.deps.col.staff.findOne({ name: 'Alina' }))!._id;
  const service = (await ctx.deps.col.services.findOne({ defaultKey: 'gel-polish' }))!;
  gel = { id: service._id, name: service.name };
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  ctx.setNow(LAST_END);
  // Access tokens last minutes; the tests jump weeks.
  expect((await owner.post('/api/auth/refresh')).status).toBe(200);
  pushed.length = 0;
  setPushTransport(ctx.deps, {
    async send(target, payload, options) {
      pushed.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as Record<string, string>, options });
      return 201;
    },
  });
  await ctx.deps.col.appointments.deleteMany({});
  await ctx.deps.col.notificationLog.deleteMany({ kind: 'rebook' });
  await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $unset: { rebook: '' } });
  invalidateSettingsCache(ctx.deps);
});
afterEach(() => {
  setPushTransport(ctx.deps, null);
});

/** A visit written straight to the database: gel polish with Alina, almond shape, completed. */
async function visit(clientId: string, end: Date, extra: Partial<AppointmentDoc> = {}): Promise<AppointmentDoc> {
  const start = new Date(end.getTime() - 90 * MIN);
  const doc: AppointmentDoc = {
    _id: new ObjectId(),
    code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    clientId: new ObjectId(clientId),
    client: { name: 'Ana', surname: 'Rusu', phone: null, email: 'snapshot@example.com' },
    staffId,
    services: [{ serviceId: gel.id, name: gel.name, durationMin: 90, price: 300, priceFrom: false }],
    nailShape: 'almond',
    start,
    end,
    durationMin: 90,
    totalPrice: 300,
    priceFrom: false,
    status: 'completed',
    notes: '',
    staffNotes: '',
    source: 'client',
    placedAt: new Date(start.getTime() - 7 * DAY),
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: '',
    createdBy: new ObjectId(clientId),
    createdAt: new Date(start.getTime() - 7 * DAY),
    updatedAt: end,
    ...extra,
  };
  await ctx.deps.col.appointments.insertOne(doc);
  return doc;
}

/** A client who signed up, with a phone that has notifications on. */
async function client(overrides: { locale?: 'ro' | 'ru' | 'en'; prefs?: Record<string, unknown> } = {}) {
  const registered = await registerClient(ctx);
  const id = new ObjectId(registered.user.id);
  if (overrides.locale) await ctx.deps.col.users.updateOne({ _id: id }, { $set: { locale: overrides.locale } });
  const endpoint = `https://fcm.googleapis.com/fcm/send/rebook-${registered.user.id}`;
  const subscribed = await registered.client.post('/api/notifications/push/subscribe', {
    endpoint,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  });
  expect(subscribed.status).toBe(200);
  if (overrides.prefs) expect((await registered.client.patch('/api/notifications/prefs', overrides.prefs)).status).toBe(200);
  await ctx.flush();
  return { ...registered, id, endpoint };
}

type Client = Awaited<ReturnType<typeof client>>;

/** The come-back emails and pushes one client got. */
const mailsTo = (c: Client) => ctx.sentMail.filter((m) => m.to === c.user.email && m.html.includes('/book?services='));
const pushesTo = (c: Client) => pushed.filter((p) => p.endpoint === c.endpoint && p.payload.tag === 'rebook');
const logsOf = (c: Client) => ctx.deps.col.notificationLog.find({ kind: 'rebook', userId: c.id }).sort({ _id: 1 }).toArray();

async function tick(when: Date) {
  ctx.setNow(when);
  return runDueNotifications(ctx.deps);
}

async function patchRebook(body: Record<string, unknown>) {
  expect((await owner.post('/api/auth/refresh')).status).toBe(200);
  const res = await owner.patch('/api/admin/settings', { rebook: body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.settings.rebook;
}

describe('the schedule', () => {
  it('puts step k at firstAfterDays + (k - 1) · repeatEveryDays, each due until the next, none after the last', () => {
    const schedule = { firstAfterDays: 28, repeatEveryDays: 14, maxReminders: 3 };
    expect(dueStep(LAST_END, at(28, -MIN), schedule)).toBeNull();
    expect(dueStep(LAST_END, at(28), schedule)).toBe(1);
    expect(dueStep(LAST_END, at(41), schedule)).toBe(1);
    expect(dueStep(LAST_END, at(42), schedule)).toBe(2);
    expect(dueStep(LAST_END, at(56), schedule)).toBe(3);
    expect(dueStep(LAST_END, at(70, -MIN), schedule)).toBe(3);
    expect(dueStep(LAST_END, at(70), schedule)).toBeNull();
    expect(dueStep(LAST_END, at(90), { ...schedule, maxReminders: 1 })).toBeNull();
    expect([1, 2, 3].map((step) => toneOf(step, 3))).toEqual(['first', 'nudge', 'last']);
    expect([1, 2, 3, 4, 5].map((step) => toneOf(step, 5))).toEqual(['first', 'nudge', 'nudge', 'nudge', 'last']);
    expect([1, 2].map((step) => toneOf(step, 2))).toEqual(['first', 'last']);
    expect(toneOf(1, 1)).toBe('first');
  });

  it('fills placeholders and leaves no stray comma for an empty one', () => {
    const values = { name: 'Ana', services: 'Gel polish', master: 'Alina' };
    expect(fillText('Hi {name}! {services} with {master}.', values)).toBe('Hi Ana! Gel polish with Alina.');
    expect(fillText('Bună, {name}! Ce faci?', { ...values, name: '' })).toBe('Bună! Ce faci?');
    expect(fillText('Hi {name}, see you', { ...values, name: '' })).toBe('Hi, see you');
  });
});

describe('come-back reminders', () => {
  it('send the first one at firstAfterDays and not before, by email and push, once', async () => {
    const c = await client();
    const last = await visit(c.user.id, LAST_END);

    await tick(at(28, -MIN));
    expect(mailsTo(c)).toHaveLength(0);
    expect(pushesTo(c)).toHaveLength(0);

    const first = await tick(at(28));
    expect(first.sent).toBe(1);
    const link = `/book?services=${gel.id.toHexString()}&step=time&shape=almond&staff=${staffId.toHexString()}`;
    const [mail] = mailsTo(c);
    expect(mail!.subject).toBe('E timpul pentru o manichiură nouă?');
    expect(mail!.html).toContain('Ultima ta vizită: Acoperire cu lac gel, cu Alina.');
    expect(mail!.html).toContain(`href="http://localhost:5180${link.replace(/&/g, '&amp;')}"`);
    expect(mail!.html).toContain('Programează-te');
    expect(mail!.html).toContain('Acum 4 săptămâni');
    expect(mail!.html).toContain('href="http://localhost:5180/profile/notifications"');
    expect(mail!.text).toContain(`Programează-te: http://localhost:5180${link}`);
    expect(mail!.text).toContain('Le poți opri oricând');
    expect(pushesTo(c)).toHaveLength(1);
    const [push] = pushesTo(c);
    expect(push!.payload).toMatchObject({
      title: 'E timpul pentru o manichiură nouă?',
      body: `Bună, Ana! Ultima ta vizită: Acoperire cu lac gel, cu Alina. Când ești gata pentru următoarea, te programezi într-un minut.`,
      url: link,
      tag: 'rebook',
      lang: 'ro',
      timestamp: at(28).getTime(),
    });
    // The declarative copy (shown by Safari if the service worker can't) opens the same page.
    expect(push!.payload).toHaveProperty('notification.navigate', `http://localhost:5180${link}`);
    expect(push!.options).toEqual({ ttlSec: 3 * 86_400, urgency: 'normal', topic: 'rebook' });
    expect(await logsOf(c)).toMatchObject([
      { _id: `rebook:${c.user.id}:${last._id.toHexString()}:1`, status: 'sent', channels: { email: 'sent', push: 'sent' } },
    ]);

    // Idempotent: the next runs of the same day send nothing more.
    const second = await tick(at(28, HOUR));
    expect(second.sent).toBe(0);
    expect(second.duplicates).toBeGreaterThanOrEqual(1);
    expect(mailsTo(c)).toHaveLength(1);
    expect(pushesTo(c)).toHaveLength(1);
  });

  it('follow with the next ones every repeatEveryDays, each in its own tone, and stop at maxReminders', async () => {
    const c = await client({ locale: 'en' });
    await visit(c.user.id, LAST_END);

    expect((await tick(at(28))).sent).toBe(1);
    expect((await tick(at(41))).sent).toBe(0);
    expect((await tick(at(42))).sent).toBe(1);
    expect((await tick(at(55))).sent).toBe(0);
    expect((await tick(at(56))).sent).toBe(1);
    for (const day of [57, 70, 84, 120]) expect((await tick(at(day))).sent, `day ${day}`).toBe(0);

    expect(mailsTo(c).map((m) => m.subject)).toEqual(['Time for a refill?', 'Thinking about your next visit?', "We'd love to see you again"]);
    // The one in between carries the loyalty card: one stamp so far, the 4th visit is 15% off.
    const nudge = mailsTo(c)[1]!;
    expect(nudge.html).toContain('Loyalty card');
    expect(nudge.html).toContain('3 more visits to 15% off');
    expect(pushesTo(c)[1]!.payload.body).toBe(
      "Hi Ana! It's been a while since your last visit. When you feel like fresh nails, pick a time that suits you in the app. Loyalty card: 3 more visits to 15% off.",
    );
    expect(mailsTo(c)[0]!.html).not.toContain('Loyalty card');
    expect(mailsTo(c)[2]!.html).not.toContain('Loyalty card');
    expect((await logsOf(c)).map((l) => l._id.split(':').at(-1))).toEqual(['1', '2', '3']);
  });

  it('follow the number the owner sets, and the loyalty line only while the card runs', async () => {
    await patchRebook({ maxReminders: 2, repeatEveryDays: 7 });
    const c = await client({ locale: 'en' });
    await visit(c.user.id, LAST_END);
    expect((await tick(at(28))).sent).toBe(1);
    expect((await tick(at(35))).sent).toBe(1);
    expect((await tick(at(42))).sent).toBe(0);
    // Two in all: the first, then the last one (no loyalty line on it).
    expect(mailsTo(c).map((m) => m.subject)).toEqual(['Time for a refill?', "We'd love to see you again"]);
  });

  it('never go out while the client has an upcoming booking, and a new visit starts the count again', async () => {
    const booked = await client();
    const pending = await client();
    const last = await visit(booked.user.id, LAST_END);
    await visit(pending.user.id, LAST_END);
    const next = await visit(booked.user.id, at(35), { status: 'confirmed', createdAt: at(20), placedAt: at(20) });
    await visit(pending.user.id, at(33), { status: 'pending', createdAt: at(27), placedAt: at(27) });

    for (const day of [28, 30, 34]) await tick(at(day));
    expect(mailsTo(booked)).toHaveLength(0);
    expect(mailsTo(pending)).toHaveLength(0);
    expect(pushesTo(booked)).toHaveLength(0);

    // The visit happened: the count starts from it, and the old one never resumes.
    await ctx.deps.col.appointments.updateOne({ _id: next._id }, { $set: { status: 'completed' } });
    for (const day of [42, 56, 62]) expect((await tick(at(day))).sent, `day ${day}`).toBe(0);
    expect((await tick(at(63))).sent).toBe(1);
    const logs = await logsOf(booked);
    expect(logs.map((l) => l._id)).toEqual([`rebook:${booked.user.id}:${next._id.toHexString()}:1`]);
    expect(logs.some((l) => l._id.includes(last._id.toHexString()))).toBe(false);
  });

  it('wait while a booking stands after the visit; one cancelled or missed does not stop them', async () => {
    const cancelled = await client();
    const missed = await client();
    const unmarked = await client();
    await visit(cancelled.user.id, LAST_END);
    await visit(missed.user.id, LAST_END);
    await visit(unmarked.user.id, LAST_END);
    await visit(cancelled.user.id, at(40), { status: 'cancelled', cancelledBy: 'client', cancelledAt: at(10), createdAt: at(5) });
    await visit(missed.user.id, at(20), { status: 'no_show' });
    // Came in, but the visit was not marked as done yet.
    await visit(unmarked.user.id, at(20), { status: 'confirmed' });

    for (const day of [28, 42, 56]) await tick(at(day));
    // Nothing booked any more: the three reminders go out as for anyone.
    for (const c of [cancelled, missed]) expect(mailsTo(c)).toHaveLength(3);
    expect(mailsTo(unmarked)).toHaveLength(0);
  });

  it('send only the latest due one after downtime, and never two within one period', async () => {
    const c = await client({ locale: 'en' });
    await visit(c.user.id, LAST_END);

    // Down from day 27 to day 45: the first one is past, the second is due.
    const back = await tick(at(45));
    expect(back.sent).toBe(1);
    expect(mailsTo(c).map((m) => m.subject)).toEqual(['Thinking about your next visit?']);
    expect((await tick(at(45, HOUR))).sent).toBe(0);

    // The third falls due on day 56, but comes a full period after the second.
    expect((await tick(at(56))).sent).toBe(0);
    expect((await tick(at(59, -HOUR))).sent).toBe(0);
    expect((await tick(at(59, HOUR))).sent).toBe(1);
    expect(mailsTo(c).map((m) => m.subject)).toEqual(['Thinking about your next visit?', "We'd love to see you again"]);
    expect((await logsOf(c)).map((l) => l._id.split(':').at(-1))).toEqual(['2', '3']);
  });

  it('go out in the studio daytime only', async () => {
    const c = await client();
    // Ended at 20:30 local: the first one is due at 20:30, four weeks later.
    const late = new Date(LAST_END.getTime() + 8.5 * HOUR);
    await visit(c.user.id, late);
    expect((await tick(new Date(late.getTime() + 28 * DAY))).sent).toBe(0);
    expect((await tick(new Date(late.getTime() + 28 * DAY + 4 * HOUR))).sent).toBe(0); // 00:30
    expect((await tick(new Date('2026-06-30T06:59:00Z'))).sent).toBe(0); // 09:59
    expect((await tick(new Date('2026-06-30T07:00:00Z'))).sent).toBe(1); // 10:00
    expect(mailsTo(c)).toHaveLength(1);
  });

  it("follow each client's preferences per channel, and a reminder switched on later still goes out while due", async () => {
    const appOnly = await client({ prefs: { rebook: { email: false } } });
    const quiet = await client({ prefs: { rebook: { email: false, push: false } } });
    await visit(appOnly.user.id, LAST_END);
    await visit(quiet.user.id, LAST_END);

    await tick(at(28));
    expect(mailsTo(appOnly)).toHaveLength(0);
    expect(pushesTo(appOnly)).toHaveLength(1);
    expect(mailsTo(quiet)).toHaveLength(0);
    expect(pushesTo(quiet)).toHaveLength(0);
    // Nothing is recorded for the one who switched them off...
    expect(await logsOf(quiet)).toEqual([]);

    // ...so turning them back on still lets the one that is due go out.
    expect((await quiet.client.post('/api/auth/refresh')).status).toBe(200);
    expect((await quiet.client.patch('/api/notifications/prefs', { rebook: { email: true } })).status).toBe(200);
    await tick(at(29));
    expect(mailsTo(quiet)).toHaveLength(1);
    expect(pushesTo(quiet)).toHaveLength(0);
  });

  it('skip demo accounts, walk-ins without an account, blocked clients and staff', async () => {
    const demo = await client();
    const blocked = await client();
    const staff = await client();
    await ctx.deps.col.users.updateOne({ _id: demo.id }, { $set: { isDemo: true } });
    await ctx.deps.col.users.updateOne({ _id: blocked.id }, { $set: { bookingBlocked: true } });
    await ctx.deps.col.users.updateOne({ _id: staff.id }, { $set: { role: 'admin' } });
    const walkIn = new ObjectId();
    await ctx.deps.col.users.insertOne({
      _id: walkIn,
      email: 'walk.in@gmail.com',
      name: 'Elena',
      surname: 'Rusu',
      phone: '+37369000111',
      role: 'client',
      locale: 'ro',
      passwordHash: null,
      googleId: null,
      isActive: true,
      bookingBlocked: false,
      tokenVersion: 0,
      notes: '',
      search: '',
      lastLoginAt: null,
      createdAt: LAST_END,
      updatedAt: LAST_END,
      deletedAt: null,
    });
    for (const id of [demo.user.id, blocked.user.id, staff.user.id, walkIn.toHexString()]) await visit(id, LAST_END);

    const summary = await tick(at(28));
    expect(summary.sent).toBe(0);
    for (const c of [demo, blocked, staff]) {
      expect(mailsTo(c)).toHaveLength(0);
      expect(pushesTo(c)).toHaveLength(0);
    }
    expect(ctx.sentMail.filter((m) => m.to === 'walk.in@gmail.com')).toHaveLength(0);
    expect(await ctx.deps.col.notificationLog.countDocuments({ kind: 'rebook' })).toBe(0);
  });

  it('stop when the studio switches them off, and use only the channels the studio chose', async () => {
    const c = await client();
    await visit(c.user.id, LAST_END);
    await patchRebook({ enabled: false });
    expect((await tick(at(28))).sent).toBe(0);
    expect(mailsTo(c)).toHaveLength(0);

    await patchRebook({ enabled: true, channels: { email: false } });
    expect((await tick(at(29))).sent).toBe(1);
    expect(mailsTo(c)).toHaveLength(0);
    expect(pushesTo(c)).toHaveLength(1);
  });

  it("use the studio's own texts in the client's language, the built-in ones where left empty", async () => {
    await patchRebook({
      texts: {
        first: {
          title: { ro: 'Hai la o corecție, {name}?' },
          body: { ro: '{services} cu {master} a fost acum ceva timp. Te așteptăm!', en: '  ' },
        },
      },
    });
    const ro = await client();
    const en = await client({ locale: 'en' });
    await visit(ro.user.id, LAST_END);
    await visit(en.user.id, LAST_END);
    await tick(at(28));
    expect(pushesTo(ro)[0]!.payload).toMatchObject({
      title: 'Hai la o corecție, Ana?',
      body: 'Acoperire cu lac gel cu Alina a fost acum ceva timp. Te așteptăm!',
    });
    expect(mailsTo(ro)[0]!.subject).toBe('Hai la o corecție, Ana?');
    expect(pushesTo(en)[0]!.payload).toMatchObject({
      title: 'Time for a refill?',
      body: 'Hi Ana! Your last visit: Gel polish with Alina. Whenever you are ready for the next one, booking takes a minute.',
    });
  });
});

describe('come-back reminder settings', () => {
  it('start on: after 28 days, then every 14, three in all, by email and in the app, built-in texts', async () => {
    const res = await owner.get('/api/admin/settings');
    const empty = { ro: '', ru: '', en: '' };
    expect(res.body.settings.rebook).toEqual({
      enabled: true,
      firstAfterDays: 28,
      repeatEveryDays: 14,
      maxReminders: 3,
      channels: { email: true, push: true },
      texts: Object.fromEntries(['first', 'nudge', 'last'].map((tone) => [tone, { title: empty, body: empty }])),
    });
    // Clients see the group in Profile → Notifications while the studio sends them.
    expect((await ctx.client().get('/api/config')).body.rebook).toEqual({ enabled: true });
  });

  it('are validated, and only the owner changes them', async () => {
    const long = 'x'.repeat(81);
    for (const rebook of [
      { firstAfterDays: 13 },
      { firstAfterDays: 91 },
      { firstAfterDays: 28.5 },
      { firstAfterDays: '28' },
      { repeatEveryDays: 6 },
      { repeatEveryDays: 61 },
      { maxReminders: 0 },
      { maxReminders: 6 },
      { enabled: 'yes' },
      { texts: { first: { title: { ro: long } } } },
      { texts: { nudge: { body: { ru: 'y'.repeat(301) } } } },
    ]) {
      const res = await owner.patch('/api/admin/settings', { rebook });
      expect(res.status, JSON.stringify(rebook)).toBe(422);
    }
    const typo = await owner.patch('/api/admin/settings', { rebook: { texts: { last: { body: { ro: 'Te așteptăm, {nume}!' } } } } });
    expect(typo.body.error.fields).toEqual({ 'rebook.texts.last.body.ro': 'unknown_placeholder' });
    const markup = await owner.patch('/api/admin/settings', { rebook: { texts: { first: { title: { en: '<b>Hi</b>' } } } } });
    expect(markup.body.error.fields).toEqual({ 'rebook.texts.first.title.en': 'plain_text' });
    const silent = await owner.patch('/api/admin/settings', { rebook: { channels: { email: false, push: false } } });
    expect(silent.body.error.fields).toEqual({ 'rebook.channels': 'one_channel' });
    // Switched off, no channel is fine.
    expect((await patchRebook({ enabled: false, channels: { email: false, push: false } })).channels).toEqual({ email: false, push: false });

    const { client: c } = await registerClient(ctx);
    expect((await c.patch('/api/admin/settings', { rebook: { enabled: false } })).status).toBe(403);
    const master = await registerClient(ctx);
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(master.user.id) }, { $set: { role: 'admin' } });
    expect((await master.client.patch('/api/admin/settings', { rebook: { enabled: false } })).status).toBe(403);
    expect((await master.client.get('/api/admin/settings')).body.settings.rebook.enabled).toBe(false);
  });

  it('save only what changed, keep the rest, trim texts and count as the studio own choice', async () => {
    await patchRebook({ texts: { nudge: { title: { en: '  Missing   you, {name}?  ' } } } });
    const saved = await patchRebook({ firstAfterDays: 21, maxReminders: 5 });
    expect(saved).toMatchObject({ enabled: true, firstAfterDays: 21, repeatEveryDays: 14, maxReminders: 5, channels: { email: true, push: true } });
    expect(saved.texts.nudge.title).toEqual({ ro: '', ru: '', en: 'Missing you, {name}?' });
    // "Reset to default": the text emptied again.
    expect((await patchRebook({ texts: { nudge: { title: { ro: '', ru: '', en: '' } } } })).texts.nudge.title).toEqual({ ro: '', ru: '', en: '' });
    const doc = await ctx.deps.col.settings.findOne({ _id: 'studio' });
    expect(doc?.customized).toContain('rebook');
  });

  it('fill in what a studio saved before a field existed, or out of range, with the default', async () => {
    await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $set: { rebook: { enabled: false, firstAfterDays: 400 } as never } });
    invalidateSettingsCache(ctx.deps);
    const res = await owner.get('/api/admin/settings');
    expect(res.body.settings.rebook).toMatchObject({ enabled: false, firstAfterDays: 28, repeatEveryDays: 14, maxReminders: 3 });
    expect(res.body.settings.rebook.texts.last.body).toEqual({ ro: '', ru: '', en: '' });
  });

  it('give staff the built-in texts and example values to preview them with', async () => {
    const res = await owner.get('/api/admin/settings/rebook');
    expect(res.status).toBe(200);
    expect(res.body.defaults.first.title).toEqual({ ro: 'E timpul pentru o manichiură nouă?', ru: 'Пора обновить маникюр?', en: 'Time for a refill?' });
    expect(res.body.placeholders).toEqual(['name', 'services', 'master']);
    expect(res.body.available).toEqual({ email: true, push: true });
    expect(res.body.sample.en).toMatchObject({ name: 'Ana', master: 'Alina', loyalty: 'Loyalty card: 2 more visits to 15% off.' });
    expect(res.body.sample.ru.loyalty).toBe('Карта лояльности: ещё 2 визита до скидки −15%.');
    expect(res.body.sample.ro.services).toBeTruthy();
  });

  it('"Send me a test": the first reminder to the owner, by the channels the studio uses', async () => {
    const res = await owner.post('/api/admin/settings/rebook/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: { to: 'owner@example.com', sent: true }, push: { sent: 0, devices: 0 } });
    const mail = ctx.sentMail.filter((m) => m.to === 'owner@example.com').at(-1)!;
    expect(mail.subject).toBe('E timpul pentru o manichiură nouă?');
    expect(mail.html).toContain('Bună, Olga!');
    expect(mail.html).toContain('/book?services=');

    await patchRebook({ channels: { email: false } });
    expect((await owner.post('/api/admin/settings/rebook/test')).body).toEqual({ email: null, push: { sent: 0, devices: 0 } });

    const master = await registerClient(ctx);
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(master.user.id) }, { $set: { role: 'admin' } });
    expect((await master.client.post('/api/admin/settings/rebook/test')).status).toBe(403);
    expect((await master.client.get('/api/admin/settings/rebook')).status).toBe(200);
  });
});

describe('the "Reminders to come back" preference', () => {
  it('is on by default, also for preferences saved before it existed, and can be switched per channel', async () => {
    const { client: c, user } = await registerClient(ctx);
    await ctx.deps.col.users.updateOne(
      { _id: new ObjectId(user.id) },
      { $set: { notificationPrefs: { reminders: { enabled: true, leadMinutes: [60], email: true, push: true }, loyalty: { email: true, push: false } } as never } },
    );
    const before = await c.get('/api/notifications');
    expect(before.body.prefs.rebook).toEqual({ email: true, push: true });
    expect(before.body.prefs.loyalty).toEqual({ email: true, push: false });
    const off = await c.patch('/api/notifications/prefs', { rebook: { push: false } });
    expect(off.body.prefs.rebook).toEqual({ email: true, push: false });
    expect((await c.patch('/api/notifications/prefs', { rebook: { push: 'no' } })).status).toBe(422);
  });
});

describe('the come-back email', () => {
  it('escapes what it shows and drops unsafe links', () => {
    const mail = rebookEmail({
      to: 'ana@gmail.com',
      name: 'Ana',
      locale: 'ru',
      timeZone: 'Europe/Chisinau',
      now: at(28),
      title: 'Пора <b>обновить</b>',
      body: 'Здравствуйте, <script>alert(1)</script>!',
      visit: { end: LAST_END, services: ['Гель-лак', 'Френч'], master: 'Alina "the best"' },
      loyalty: { label: 'Карта лояльности', text: 'ещё 2 визита до скидки −15%' },
      bookUrl: 'javascript:alert(1)',
      settingsUrl: 'https://app.example/ru/profile/notifications',
    });
    expect(mail.subject).toBe('Пора <b>обновить</b>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Alina &quot;the best&quot;');
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).toContain('4 недели назад');
    expect(mail.html).toContain('Ещё 2 визита до скидки −15%');
    expect(mail.text).toContain('Гель-лак\nФренч');
    expect(mail.text).toContain('https://app.example/ru/profile/notifications');
  });
});
