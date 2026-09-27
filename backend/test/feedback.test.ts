import { ObjectId } from 'bson';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppointmentDoc, FeedbackDoc } from '../src/db/types';
import { feedbackRequestEmail } from '../src/lib/emails';
import { setPushTransport, type PushSendOptions } from '../src/lib/push';
import { runDueNotifications } from '../src/modules/notifications';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

const START = new Date('2026-06-01T06:00:00Z'); // Monday 09:00 in Chișinău
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const DEMO_PASSWORD = 'demo-password-for-tests';

let ctx: TestContext;
let alinaId: ObjectId;
let danaId: ObjectId;
let master: { client: TestClient; email: string };
let owner: TestClient;
let reception: TestClient;

beforeAll(async () => {
  ctx = await createTestContext({ DEMO_LOGIN: 'on' });
  await ctx.seed({ demoUsers: { password: DEMO_PASSWORD } });
  const alina = (await ctx.deps.col.staff.findOne({ name: 'Alina' }))!;
  alinaId = alina._id;
  // A second master, so each one's list can be told apart.
  danaId = new ObjectId();
  await ctx.deps.col.staff.insertOne({ ...alina, _id: danaId, name: 'Dana', userId: null, order: alina.order + 1 });

  // Alina signs in to the staff app with an account linked to her master profile.
  const registered = await registerClient(ctx, { name: 'Alina', surname: 'Master' });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(registered.user.id) }, { $set: { role: 'admin' } });
  await ctx.deps.col.staff.updateOne({ _id: alinaId }, { $set: { userId: new ObjectId(registered.user.id) } });
  master = { client: registered.client, email: registered.user.email };

  const ownerAccount = await registerClient(ctx, { name: 'Olga', surname: 'Owner' });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(ownerAccount.user.id) }, { $set: { role: 'administrator' } });
  owner = ownerAccount.client;

  // Reception: staff without a master profile.
  const desk = await registerClient(ctx, { name: 'Rita', surname: 'Desk' });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(desk.user.id) }, { $set: { role: 'admin' } });
  reception = desk.client;
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  ctx.setNow(START);
  setPushTransport(ctx.deps, null);
});

/** A visit written straight to the database, completed an hour after it started by default. */
async function visit(clientId: string, end: Date, extra: Partial<AppointmentDoc> = {}): Promise<AppointmentDoc> {
  const now = ctx.now();
  const doc: AppointmentDoc = {
    _id: new ObjectId(),
    code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    clientId: new ObjectId(clientId),
    client: { name: 'Ana', surname: 'Rusu', phone: null, email: 'snapshot@example.com' },
    staffId: alinaId,
    services: [{ serviceId: new ObjectId(), name: { ro: 'Gel lac', ru: 'Гель-лак', en: 'Gel polish' }, durationMin: 60, price: 300, priceFrom: false }],
    start: new Date(end.getTime() - HOUR),
    end,
    durationMin: 60,
    totalPrice: 300,
    priceFrom: false,
    status: 'completed',
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

describe('feedback from a client', () => {
  it('the Home card asks about the latest completed visit of the last two weeks, until it is rated or closed', async () => {
    const { client, user } = await registerClient(ctx);
    expect((await client.get('/api/feedback/pending')).body).toEqual({ visit: null });

    await visit(user.id, new Date(START.getTime() - 20 * DAY)); // too long ago
    await visit(user.id, new Date(START.getTime() + 2 * DAY), { status: 'confirmed' }); // still to come
    const done = await visit(user.id, new Date(START.getTime() - 3 * DAY));
    const pending = await client.get('/api/feedback/pending');
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({
      visit: {
        id: done._id.toHexString(),
        start: done.start.toISOString(),
        end: done.end.toISOString(),
        services: [{ ro: 'Gel lac', ru: 'Гель-лак', en: 'Gel polish' }],
        master: 'Alina',
      },
    });

    // Rated: nothing left to ask about.
    expect((await client.post('/api/feedback', { appointmentId: done._id.toHexString(), rating: 5 })).status).toBe(201);
    expect((await client.get('/api/feedback/pending')).body.visit).toBeNull();

    // A newer visit asks again; "Not now" closes it for good.
    const latest = await visit(user.id, new Date(START.getTime() - 2 * HOUR));
    expect((await client.get('/api/feedback/pending')).body.visit.id).toBe(latest._id.toHexString());
    expect((await client.post('/api/feedback/dismiss', { appointmentId: latest._id.toHexString() })).body).toEqual({ ok: true });
    expect((await client.get('/api/feedback/pending')).body.visit).toBeNull();
    expect((await ctx.deps.col.appointments.findOne({ _id: latest._id }))?.feedbackDismissedAt).toEqual(START);

    // Only one's own visits can be closed.
    const other = await registerClient(ctx);
    const theirs = await visit(other.user.id, new Date(START.getTime() - HOUR));
    const refused = await client.post('/api/feedback/dismiss', { appointmentId: theirs._id.toHexString() });
    expect(refused.status).toBe(404);
    expect((await other.client.get('/api/feedback/pending')).body.visit.id).toBe(theirs._id.toHexString());
  });

  it('rates a completed visit once: sending it again changes the same feedback', async () => {
    const { client, user } = await registerClient(ctx);
    const done = await visit(user.id, new Date(START.getTime() - HOUR));
    const id = done._id.toHexString();

    const first = await client.post('/api/feedback', { appointmentId: id, rating: 5, comment: '  Loved the colour  ' });
    expect(first.status).toBe(201);
    expect(first.body.feedback).toMatchObject({ kind: 'visit', appointmentId: id, rating: 5, comment: 'Loved the colour' });

    ctx.advance(10 * MIN);
    const second = await client.post('/api/feedback', { appointmentId: id, rating: 4, comment: 'A little chipped after a day' });
    expect(second.status).toBe(200);
    expect(second.body.feedback).toMatchObject({ id: first.body.feedback.id, rating: 4, comment: 'A little chipped after a day' });
    expect(second.body.feedback.createdAt).toBe(first.body.feedback.createdAt);
    expect(second.body.feedback.updatedAt).not.toBe(first.body.feedback.updatedAt);

    const stored = await ctx.deps.col.feedback.find({ appointmentId: done._id }).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'visit', rating: 4, locale: 'ro' });
    expect([String(stored[0]!.userId), String(stored[0]!.staffId)]).toEqual([user.id, alinaId.toHexString()]);
    const trail = await ctx.deps.col.auditLogs.find({ targetId: first.body.feedback.id }).sort({ at: 1 }).toArray();
    expect(trail.map((e) => [e.action, e.meta.rating])).toEqual([
      ['feedback.create', 5],
      ['feedback.update', 4],
    ]);
  });

  it('only rates a completed visit of its own, up to two weeks after it', async () => {
    const { client, user } = await registerClient(ctx);
    const upcoming = await visit(user.id, new Date(START.getTime() + DAY), { status: 'confirmed' });
    const missed = await visit(user.id, new Date(START.getTime() - HOUR), { status: 'no_show' });
    const old = await visit(user.id, new Date(START.getTime() - 15 * DAY));
    const other = await registerClient(ctx);
    const theirs = await visit(other.user.id, new Date(START.getTime() - HOUR));

    const rate = (appointmentId: string) => client.post('/api/feedback', { appointmentId, rating: 5 });
    for (const doc of [upcoming, missed]) {
      const res = await rate(doc._id.toHexString());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATUS');
    }
    const closed = await rate(old._id.toHexString());
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('FEEDBACK_CLOSED');
    expect((await rate(theirs._id.toHexString())).status).toBe(404);
    expect((await rate(new ObjectId().toHexString())).status).toBe(404);
    expect(await ctx.deps.col.feedback.countDocuments({ userId: new ObjectId(user.id) })).toBe(0);
  });

  it('checks what is sent (422)', async () => {
    const { client, user } = await registerClient(ctx);
    const appointmentId = (await visit(user.id, new Date(START.getTime() - HOUR)))._id.toHexString();
    const fieldOf = async (body: unknown) => {
      const res = await client.post('/api/feedback', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      return res.body.error.fields as Record<string, string>;
    };

    expect(await fieldOf({ appointmentId, comment: 'Stars are needed for a visit' })).toEqual({ rating: 'required' });
    expect(await fieldOf({ appointmentId, rating: null })).toEqual({ rating: 'required' });
    for (const rating of [0, 6, 2.5, '5']) expect(await fieldOf({ appointmentId, rating })).toEqual({ rating: 'invalid' });
    expect(await fieldOf({ appointmentId, rating: 5, comment: 'x'.repeat(1001) })).toEqual({ comment: 'too_long' });
    expect(await fieldOf({ appointmentId: 'not-an-id', rating: 5 })).toEqual({ appointmentId: 'invalid_id' });
    // General feedback is a message: a few words at least.
    expect(await fieldOf({})).toEqual({ comment: 'required' });
    expect(await fieldOf({ comment: '   ', rating: 4 })).toEqual({ comment: 'required' });
    expect(await fieldOf({ comment: 'ok' })).toEqual({ comment: 'too_short' });
    expect(await ctx.deps.col.feedback.countDocuments({ userId: new ObjectId(user.id) })).toBe(0);

    // The longest comment allowed is saved whole.
    expect((await client.post('/api/feedback', { appointmentId, rating: 3, comment: 'y'.repeat(1000) })).status).toBe(201);
  });

  it('general feedback: a comment, stars optional', async () => {
    const { client, user } = await registerClient(ctx);
    const plain = await client.post('/api/feedback', { comment: 'Booking in the app is so easy' });
    expect(plain.status).toBe(201);
    expect(plain.body.feedback).toMatchObject({ kind: 'general', appointmentId: null, rating: null, comment: 'Booking in the app is so easy' });
    const starred = await client.post('/api/feedback', { comment: 'Lovely studio', rating: 5 });
    expect(starred.body.feedback).toMatchObject({ kind: 'general', rating: 5 });
    expect(await ctx.deps.col.feedback.countDocuments({ userId: new ObjectId(user.id), kind: 'general', staffId: null })).toBe(2);
  });

  it('needs a signed-in account that can change things', async () => {
    const anonymous = ctx.client();
    expect((await anonymous.get('/api/feedback/pending')).status).toBe(401);
    expect((await anonymous.post('/api/feedback', { comment: 'Hello there' })).status).toBe(401);

    const demo = await loginAs(ctx, 'client.demo@example.com', DEMO_PASSWORD);
    expect((await demo.get('/api/feedback/pending')).status).toBe(200);
    const refused = await demo.post('/api/feedback', { comment: 'Hello there' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('DEMO_READ_ONLY');
  });

  it('goes with the client: in the data export, and its words are erased with the account', async () => {
    const { client, user } = await registerClient(ctx);
    const done = await visit(user.id, new Date(START.getTime() - HOUR));
    await client.post('/api/feedback', { appointmentId: done._id.toHexString(), rating: 4, comment: 'Good, a bit late' });
    ctx.advance(MIN);
    await client.post('/api/feedback', { comment: 'Please add evening hours' });

    const exported = await client.get('/api/me/export');
    expect(exported.body.feedback).toEqual([
      expect.objectContaining({ about: 'general', visit: null, rating: null, comment: 'Please add evening hours' }),
      expect.objectContaining({ about: 'visit', visit: done.code, rating: 4, comment: 'Good, a bit late' }),
    ]);

    expect((await client.delete('/api/me', { password: strongPassword })).status).toBe(200);
    const left = await ctx.deps.col.feedback.find({ userId: new ObjectId(user.id) }).toArray();
    expect(left.map((f) => [f.kind, f.rating, f.comment])).toEqual([['visit', 4, '']]);
  });
});

describe('staff read feedback', () => {
  let items: { alina: FeedbackDoc; dana: FeedbackDoc; general: FeedbackDoc };

  beforeAll(async () => {
    await ctx.deps.col.feedback.deleteMany({});
    // Sent over the morning, a few minutes apart, before the staff look.
    ctx.setNow(new Date(START.getTime() - 3 * HOUR));
    const { client, user } = await registerClient(ctx, { name: 'Maria', surname: 'Popescu' });
    const withAlina = await visit(user.id, new Date(START.getTime() - 2 * DAY));
    const withDana = await visit(user.id, new Date(START.getTime() - DAY), { staffId: danaId });
    await client.post('/api/feedback', { appointmentId: withAlina._id.toHexString(), rating: 5, comment: 'Perfect French' });
    ctx.advance(5 * MIN);
    await client.post('/api/feedback', { appointmentId: withDana._id.toHexString(), rating: 2 });
    ctx.advance(5 * MIN);
    await client.post('/api/feedback', { comment: 'Parking is hard to find' });
    ctx.setNow(START);
    const [alina, dana, general] = await Promise.all([
      ctx.deps.col.feedback.findOne({ appointmentId: withAlina._id }),
      ctx.deps.col.feedback.findOne({ appointmentId: withDana._id }),
      ctx.deps.col.feedback.findOne({ kind: 'general', userId: new ObjectId(user.id) }),
    ]);
    items = { alina: alina!, dana: dana!, general: general! };
  });

  it('the owner reads everything, newest first, with the average on top', async () => {
    const res = await owner.get('/api/admin/feedback');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('all');
    expect(res.body.feedback.map((f: { id: string }) => f.id)).toEqual([items.general, items.dana, items.alina].map((f) => f._id.toHexString()));
    expect(res.body.summary).toEqual({ average: 3.5, count: 2, byRating: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 }, total: 3 });
    expect(res.body).toMatchObject({ total: 3, page: 1, pages: 1 });

    const [general, dana, alina] = res.body.feedback;
    expect(general).toMatchObject({ kind: 'general', rating: null, comment: 'Parking is hard to find', visit: null, master: null });
    expect(general.client).toMatchObject({ name: 'Maria', surname: 'Popescu' });
    expect(dana).toMatchObject({ kind: 'visit', rating: 2, comment: '', master: { id: danaId.toHexString(), name: 'Dana' } });
    expect(alina).toMatchObject({
      rating: 5,
      comment: 'Perfect French',
      master: { name: 'Alina' },
      visit: { services: [{ ro: 'Gel lac', ru: 'Гель-лак', en: 'Gel polish' }], start: expect.any(String), code: expect.any(String) },
    });

    // One rating at a time; the numbers on top stay those of the whole list.
    const fives = await owner.get('/api/admin/feedback?rating=5');
    expect(fives.body.feedback.map((f: { id: string }) => f.id)).toEqual([items.alina._id.toHexString()]);
    expect(fives.body.total).toBe(1);
    expect(fives.body.summary.total).toBe(3);
    expect((await owner.get('/api/admin/feedback?rating=9')).status).toBe(422);
  });

  it('a master reads only feedback on their own visits; reception and clients read none', async () => {
    const mine = await master.client.get('/api/admin/feedback');
    expect(mine.status).toBe(200);
    expect(mine.body.scope).toBe('own');
    expect(mine.body.feedback.map((f: { id: string }) => f.id)).toEqual([items.alina._id.toHexString()]);
    expect(mine.body.summary).toEqual({ average: 5, count: 1, byRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 }, total: 1 });
    expect((await master.client.get('/api/admin/feedback?rating=2')).body.feedback).toEqual([]);

    const desk = await reception.get('/api/admin/feedback');
    expect(desk.status).toBe(200);
    expect(desk.body).toMatchObject({ scope: 'none', feedback: [], total: 0, summary: { average: null, count: 0, total: 0 } });

    const { client } = await registerClient(ctx);
    const refused = await client.get('/api/admin/feedback');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
  });

  it('pages 20 at a time', async () => {
    const userId = new ObjectId();
    const docs: FeedbackDoc[] = Array.from({ length: 21 }, (_, i) => ({
      _id: new ObjectId(),
      userId,
      kind: 'general',
      appointmentId: null,
      staffId: null,
      rating: null,
      comment: `Note ${i}`,
      locale: 'en',
      createdAt: new Date(START.getTime() - (100 + i) * DAY),
      updatedAt: new Date(START.getTime() - (100 + i) * DAY),
    }));
    await ctx.deps.col.feedback.insertMany(docs);
    const first = await owner.get('/api/admin/feedback');
    expect(first.body).toMatchObject({ total: 24, page: 1, pages: 2 });
    expect(first.body.feedback).toHaveLength(20);
    const second = await owner.get('/api/admin/feedback?page=2');
    expect(second.body.feedback.map((f: { comment: string }) => f.comment)).toEqual(['Note 17', 'Note 18', 'Note 19', 'Note 20']);
    await ctx.deps.col.feedback.deleteMany({ userId });
  });

  it('demo staff see the ratings but not who wrote what', async () => {
    const demoOwner = await loginAs(ctx, 'owner.demo@example.com', DEMO_PASSWORD);
    const res = await demoOwner.get('/api/admin/feedback');
    expect(res.status).toBe(200);
    const alina = res.body.feedback.find((f: { id: string }) => f.id === items.alina._id.toHexString());
    expect(alina).toMatchObject({ rating: 5, comment: '•••', client: { name: 'M•••', surname: 'P.' } });
  });
});

describe('"How was your visit?" after a visit', () => {
  let client: TestClient;
  let user: { id: string; email: string };

  beforeEach(async () => {
    ctx.setNow(START);
    await ctx.deps.col.appointments.deleteMany({});
    ({ client, user } = await registerClient(ctx));
    await ctx.flush();
  });

  it('goes out once, an hour after a completed visit, with 1 to 5 to tap', async () => {
    const done = await visit(user.id, new Date(START.getTime() - 30 * MIN));
    const id = done._id.toHexString();
    const before = mailsTo(user.email).length;

    // Just finished: a moment to get home first.
    await runDueNotifications(ctx.deps);
    expect(mailsTo(user.email)).toHaveLength(before);

    ctx.setNow(new Date(START.getTime() + 31 * MIN));
    const first = await runDueNotifications(ctx.deps);
    expect(first).toMatchObject({ sent: 1, failed: 0 });
    const mail = mailsTo(user.email).at(-1)!;
    expect(mail.subject).toBe('Cum a fost vizita ta la Nails by Alynna?');
    expect(mail.html).toContain('Cum a fost vizita\u00a0ta?');
    expect(mail.html).toContain('Alina ar vrea să afle cum ți s-a părut');
    expect(mail.html).toContain('Gel\u00a0lac');
    expect(mail.html).toContain(done.code);
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(mail.html).toContain(`http://localhost:5180/feedback?visit=${id}&amp;rating=${rating}`);
      expect(mail.text).toContain(`${rating}: http://localhost:5180/feedback?visit=${id}&rating=${rating}`);
    }
    expect(mail.html).toContain(`href="http://localhost:5180/feedback?visit=${id}"`);
    expect(mail.html).toContain('/profile/notifications');
    expect(mail.html).not.toMatch(/[★☆⭐]/u);

    const log = await ctx.deps.col.notificationLog.findOne({ _id: `feedback:${id}` });
    expect(log).toMatchObject({ kind: 'feedback_request', status: 'sent', channels: { email: 'sent' } });
    expect(String(log?.appointmentId)).toBe(id);

    ctx.advance(2 * HOUR);
    const second = await runDueNotifications(ctx.deps);
    expect(second.sent).toBe(0);
    expect(second.duplicates).toBeGreaterThanOrEqual(1);
    expect(mailsTo(user.email)).toHaveLength(before + 1);
  });

  it('speaks the client language, and opens the visit page by push too', async () => {
    const pushed: Array<{ payload: Record<string, string>; options: PushSendOptions }> = [];
    setPushTransport(ctx.deps, {
      async send(_target, payload, options) {
        pushed.push({ payload: JSON.parse(payload) as Record<string, string>, options });
        return 201;
      },
    });
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(user.id) }, { $set: { locale: 'en' } });
    const subscribed = await client.post('/api/notifications/push/subscribe', {
      endpoint: `https://fcm.googleapis.com/fcm/send/feedback-${user.id}`,
      keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
    });
    expect(subscribed.status).toBe(200);
    const done = await visit(user.id, new Date(START.getTime() - 5 * HOUR));
    const id = done._id.toHexString();

    await runDueNotifications(ctx.deps);
    const mail = mailsTo(user.email).at(-1)!;
    expect(mail.subject).toBe('How was your visit to Nails by Alynna?');
    expect(mail.html).toContain(`http://localhost:5180/en/feedback?visit=${id}&amp;rating=5`);
    expect(mail.text).toContain('Rate it from 1 (poor) to 5 (excellent)');
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.payload).toEqual({
      title: 'How was your visit?',
      body: 'Gel polish · with Alina. Rate it in one tap.',
      url: `/en/feedback?visit=${id}`,
      tag: `feedback-${id}`,
    });
  });

  it('stays quiet for visits not completed, already rated, too old, demo accounts and walk-ins', async () => {
    const ended = new Date(START.getTime() - 2 * HOUR);
    const before = mailsTo(user.email).length;
    await visit(user.id, ended, { status: 'confirmed' });
    await visit(user.id, ended, { status: 'no_show' });
    await visit(user.id, new Date(START.getTime() - 40 * HOUR));
    const rated = await visit(user.id, ended);
    expect((await client.post('/api/feedback', { appointmentId: rated._id.toHexString(), rating: 5 })).status).toBe(201);

    const demo = await registerClient(ctx);
    await ctx.deps.col.users.updateOne({ _id: new ObjectId(demo.user.id) }, { $set: { isDemo: true } });
    await visit(demo.user.id, ended);

    const walkIn = new ObjectId();
    const now = ctx.now();
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
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    await visit(walkIn.toHexString(), ended, { source: 'staff' });
    await ctx.flush();
    const demoBefore = mailsTo(demo.user.email).length;

    const summary = await runDueNotifications(ctx.deps);
    expect(summary.sent).toBe(0);
    expect(mailsTo(user.email)).toHaveLength(before);
    expect(mailsTo(demo.user.email)).toHaveLength(demoBefore);
    expect(mailsTo('walk.in@gmail.com')).toHaveLength(0);
    const asked = { kind: 'feedback_request' as const, userId: { $in: [new ObjectId(user.id), new ObjectId(demo.user.id), walkIn] } };
    expect(await ctx.deps.col.notificationLog.countDocuments(asked)).toBe(0);
  });

  it('follows the booking-update preferences', async () => {
    expect((await client.patch('/api/notifications/prefs', { bookingUpdates: { email: false, push: false } })).status).toBe(200);
    const before = mailsTo(user.email).length;
    await visit(user.id, new Date(START.getTime() - 2 * HOUR));
    expect((await runDueNotifications(ctx.deps)).sent).toBe(0);
    expect(mailsTo(user.email)).toHaveLength(before);
  });
});

describe('the feedback email', () => {
  it('escapes what it shows and drops unsafe links', () => {
    const hostile = '<script>alert(1)</script>';
    const mail = feedbackRequestEmail({
      to: 'ana@gmail.com',
      name: hostile,
      locale: 'ru',
      timeZone: 'Europe/Chisinau',
      now: START,
      visit: {
        code: 'ABC123',
        start: new Date(START.getTime() - 3 * HOUR),
        status: 'completed',
        services: [`Гель ${hostile}`],
        master: 'Alina "the best"',
        address: null,
        bookingUrl: null,
        directionsUrl: null,
        bookUrl: 'https://app.example/ru/book',
        settingsUrl: 'https://app.example/ru/profile/notifications',
        changeDeadline: null,
        studioPhone: null,
        durationMin: 90,
      },
      feedbackUrl: 'javascript:alert(1)',
    });
    expect(mail.subject).toBe('Как прошёл ваш визит в Nails by Alynna?');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Гель &lt;script&gt;');
    expect(mail.html).toContain('Мастеру Alina &quot;the best&quot; важно знать');
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).toContain('1\u00a0ч\u00a030\u00a0мин');
    expect(mail.text).toContain('Отзыв увидит только салон');
  });
});
