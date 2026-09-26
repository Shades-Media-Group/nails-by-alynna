import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../src/lib/time';
import { invalidateSettingsCache } from '../src/modules/settings';
import { normalizePromoCode, promoDiscount } from '../src/modules/promo/service';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

let ctx: TestContext;
let owner: TestClient;
let maria: TestClient;
let reception: TestClient;
let gelId: string;
let frenchId: string;
let alinaId: string;
let mariaId: string;

const WEEK = [0, 1, 2, 3, 4, 5, 6].map((d) => (d < 5 ? [{ start: '10:00', end: '19:00' }] : d === 5 ? [{ start: '10:00', end: '16:00' }] : []));
/** A local (Chișinău) time as the ISO instant the API uses. */
const at = (date: string, time: string) => zonedTimeToUtc(date, time, 'Europe/Chisinau').toISOString();

async function staffUser(email: string) {
  const { user } = await registerClient(ctx, { email });
  await ctx.deps.col.users.updateOne({ _id: new ObjectId(user.id) }, { $set: { role: 'admin' } });
  return { id: user.id, client: await loginAs(ctx, email, strongPassword) };
}

async function client(bonus = 0) {
  const registered = await registerClient(ctx);
  if (bonus) await ctx.deps.col.users.updateOne({ _id: new ObjectId(registered.user.id) }, { $set: { loyaltyBonus: bonus } });
  return { id: registered.user.id, http: registered.client };
}

async function createCode(by: TestClient, body: Record<string, unknown>) {
  const res = await by.post('/api/admin/promo', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.promo as { id: string; code: string; staffId: string | null };
}

const uses = async (code: string) => (await ctx.deps.col.promoCodes.findOne({ code }))!.redemptions.length;

function check(http: TestClient, params: { code: string; start: string; serviceIds?: string[]; staffId?: string; exclude?: string }) {
  const q = new URLSearchParams({
    code: params.code,
    serviceIds: (params.serviceIds ?? [gelId]).join(','),
    staffId: params.staffId ?? 'any',
    start: params.start,
    ...(params.exclude ? { exclude: params.exclude } : {}),
  });
  return http.get(`/api/promo/check?${q.toString()}`);
}

/** Moves the clock; access tokens are short-lived, so the sessions refresh like the app does. */
async function clock(iso: string, ...sessions: TestClient[]) {
  ctx.setNow(new Date(iso));
  for (const session of [owner, maria, reception, ...sessions]) expect((await session.post('/api/auth/refresh')).status).toBe(200);
}

beforeAll(async () => {
  ctx = await createTestContext();
  // The owner is also the first master (Alina).
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  // Every free time is offered, so tests can book the exact times they need.
  await ctx.deps.col.settings.updateOne({ _id: 'studio' }, { $set: { smartSlots: false } });
  invalidateSettingsCache(ctx.deps);
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  const catalog = await ctx.client().get('/api/catalog');
  const slug = (s: string) => catalog.body.services.find((x: { slug: string }) => x.slug === s).id as string;
  gelId = slug('gel-polish'); // 300 MDL, 90 min
  frenchId = slug('french'); // 30 MDL, 20 min

  alinaId = (await owner.get('/api/admin/team/me')).body.staff.id;
  const mariaUser = await staffUser('maria@example.com');
  const created = await owner.post('/api/admin/team/staff', { name: 'Maria', title: { ro: '', ru: '', en: '' }, weekly: WEEK, userId: mariaUser.id });
  expect(created.status).toBe(201);
  mariaId = created.body.staff.id;
  maria = mariaUser.client;
  reception = (await staffUser('desk@example.com')).client;
});
afterAll(async () => {
  await ctx.close();
});

describe('promo code maths', () => {
  const line = (price: number, id = new ObjectId()) => ({ serviceId: id, price });

  it('takes a percentage rounded to whole lei, and an amount never below zero', () => {
    const visit = [line(300), line(30)];
    expect(promoDiscount({ kind: 'percent', value: 15, serviceIds: null }, visit).discount).toBe(50); // 49.5 rounds up
    expect(promoDiscount({ kind: 'percent', value: 12, serviceIds: null }, [line(333)]).discount).toBe(40); // 39.96
    expect(promoDiscount({ kind: 'percent', value: 100, serviceIds: null }, visit).discount).toBe(330);
    expect(promoDiscount({ kind: 'amount', value: 100, serviceIds: null }, visit).discount).toBe(100);
    expect(promoDiscount({ kind: 'amount', value: 1000, serviceIds: null }, visit).discount).toBe(330);
  });

  it('discounts only the services a code covers', () => {
    const french = new ObjectId();
    const visit = [line(300), line(30, french)];
    expect(promoDiscount({ kind: 'percent', value: 20, serviceIds: [french] }, visit)).toMatchObject({ discount: 6, coveredTotal: 30 });
    expect(promoDiscount({ kind: 'amount', value: 50, serviceIds: [french] }, visit).discount).toBe(30);
    expect(promoDiscount({ kind: 'amount', value: 50, serviceIds: [new ObjectId()] }, visit)).toMatchObject({ discount: 0, covered: [] });
  });

  it('reads a code typed any way', () => {
    expect(normalizePromoCode(' summer20 ')).toBe('SUMMER20');
    expect(normalizePromoCode('summer-20')).toBe('SUMMER20');
    expect(normalizePromoCode('ab')).toBeNull();
    expect(normalizePromoCode('<script>')).toBeNull();
  });
});

describe('who manages codes', () => {
  it('lets the owner create codes for the whole studio or one master', async () => {
    const studio = await createCode(owner, { code: 'studio10', kind: 'percent', value: 10 });
    expect(studio).toMatchObject({ code: 'STUDIO10', staffId: null, status: 'active', usedCount: 0, maxUsesPerClient: 1, canDelete: true });
    const tied = await createCode(owner, { code: 'FORMARIA', kind: 'amount', value: 50, staffId: mariaId });
    expect(tied.staffId).toBe(mariaId);
    const list = await owner.get('/api/admin/promo');
    expect(list.body.access).toEqual({ manage: 'all', masterId: alinaId });
    expect(list.body.promos.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['STUDIO10', 'FORMARIA']));
  });

  it('lets a master manage only codes tied to them', async () => {
    const own = await createCode(maria, { code: 'MARIA5', kind: 'amount', value: 50 });
    expect(own.staffId).toBe(mariaId);
    expect((await maria.post('/api/admin/promo', { code: 'NOTMINE', kind: 'percent', value: 5, staffId: alinaId })).status).toBe(403);

    const list = await maria.get('/api/admin/promo');
    expect(list.body.access).toEqual({ manage: 'own', masterId: mariaId });
    expect(list.body.promos.map((p: { code: string }) => p.code).sort()).toEqual(['FORMARIA', 'MARIA5']);

    const studio = (await owner.get('/api/admin/promo')).body.promos.find((p: { code: string }) => p.code === 'STUDIO10');
    expect((await maria.patch(`/api/admin/promo/${own.id}`, { value: 60 })).body.promo.value).toBe(60);
    expect((await maria.patch(`/api/admin/promo/${own.id}`, { staffId: null })).status).toBe(403);
    expect((await maria.patch(`/api/admin/promo/${studio.id}`, { value: 1 })).status).toBe(404);
    expect((await maria.delete(`/api/admin/promo/${studio.id}`)).status).toBe(404);
  });

  it('shows codes to staff without a master profile, read-only, and never to clients', async () => {
    const list = await reception.get('/api/admin/promo');
    expect(list.status).toBe(200);
    expect(list.body.access).toEqual({ manage: 'none', masterId: null });
    expect(list.body.promos.length).toBeGreaterThanOrEqual(3);
    expect((await reception.post('/api/admin/promo', { code: 'DESK', kind: 'percent', value: 5 })).status).toBe(403);
    expect((await reception.patch(`/api/admin/promo/${list.body.promos[0].id}`, { value: 5 })).status).toBe(403);
    const { http } = await client();
    expect((await http.get('/api/admin/promo')).status).toBe(403);
  });

  it('checks the code and its rules', async () => {
    const bad = async (body: Record<string, unknown>) => (await owner.post('/api/admin/promo', { kind: 'percent', value: 10, ...body })).body.error;
    expect((await bad({ code: 'ab' })).fields).toEqual({ code: 'invalid_code' });
    expect((await bad({ code: 'SUMMER-20' })).fields).toEqual({ code: 'invalid_code' });
    expect((await bad({ code: 'X'.repeat(21) })).fields).toEqual({ code: 'invalid_code' });
    expect((await bad({ code: 'Studio10' })).fields).toEqual({ code: 'taken' }); // letter case doesn't make a new code
    expect((await bad({ code: 'HALFPLUS', value: 150 })).fields).toEqual({ value: 'max_percent' });
    expect((await bad({ code: 'ZERO', value: 0 })).fields).toEqual({ value: 'invalid' });
    expect((await bad({ code: 'BACKWARDS', startsAt: '2026-06-10', endsAt: '2026-06-01' })).fields).toEqual({ endsAt: 'end_before_start' });
    expect((await bad({ code: 'NOBODY', staffId: new ObjectId().toHexString() })).fields).toEqual({ staffId: 'invalid' });
    expect((await bad({ code: 'NOSERVICE', serviceIds: [new ObjectId().toHexString()] })).fields).toEqual({ serviceIds: 'invalid' });
  });

  it('deletes only codes no booking used, and keeps a used code\'s text', async () => {
    const unused = await createCode(owner, { code: 'TYPO', kind: 'percent', value: 5 });
    expect((await owner.delete(`/api/admin/promo/${unused.id}`)).status).toBe(200);

    const used = await createCode(owner, { code: 'USEDONCE', kind: 'percent', value: 5 });
    const { http } = await client();
    expect((await http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-02', '11:00'), promoCode: 'usedonce' })).status).toBe(201);
    const refused = await owner.delete(`/api/admin/promo/${used.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('IN_USE');
    expect((await owner.patch(`/api/admin/promo/${used.id}`, { code: 'RENAMED' })).body.error.fields).toEqual({ code: 'locked' });
    const off = await owner.patch(`/api/admin/promo/${used.id}`, { isActive: false });
    expect(off.body.promo).toMatchObject({ status: 'off', usedCount: 1, canDelete: false });
    const actions = (await owner.get('/api/admin/audit')).body.logs.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['promo.create', 'promo.delete', 'promo.deactivate']));
  });
});

describe('checking a code before booking', () => {
  beforeAll(async () => {
    await createCode(owner, { code: 'SLEEPING', kind: 'percent', value: 10, isActive: false });
    await createCode(owner, { code: 'MAYONLY', kind: 'percent', value: 10, endsAt: '2026-05-31' });
    await createCode(owner, { code: 'JULY', kind: 'percent', value: 10, startsAt: '2026-07-01' });
    await createCode(owner, { code: 'FRENCHONLY', kind: 'percent', value: 20, serviceIds: [frenchId] });
    await createCode(owner, { code: 'BIGVISIT', kind: 'amount', value: 100, minTotal: 500 });
    await createCode(owner, { code: 'WELCOME', kind: 'percent', value: 15, firstVisitOnly: true });
    await createCode(owner, { code: 'SINGLE', kind: 'amount', value: 30, maxUses: 1 });
  });

  it('says exactly why a code does not apply', async () => {
    const a = await client();
    const b = await client();
    const tuesday = at('2026-06-02', '12:00');
    const why = async (http: TestClient, code: string, extra: Partial<Parameters<typeof check>[1]> = {}) => {
      const res = await check(http, { code, start: tuesday, ...extra });
      expect(res.status, code).toBe(422);
      expect(res.body.error.code).toBe('PROMO_INVALID');
      return res.body.error.fields;
    };

    expect(await why(a.http, 'NOSUCHCODE')).toEqual({ promoCode: 'unknown' });
    expect(await why(a.http, 'sleeping')).toEqual({ promoCode: 'inactive' });
    expect(await why(a.http, 'MAYONLY')).toEqual({ promoCode: 'expired', endsAt: '2026-05-31' });
    expect(await why(a.http, 'JULY')).toEqual({ promoCode: 'not_started', startsAt: '2026-07-01' });
    expect(await why(a.http, 'FRENCHONLY')).toEqual({ promoCode: 'services' });
    expect(await why(a.http, 'BIGVISIT')).toEqual({ promoCode: 'min_total', minTotal: '500' });
    expect(await why(a.http, 'FORMARIA', { staffId: alinaId })).toEqual({ promoCode: 'master', master: 'Maria' });

    // Used up for everyone, used by this client, and not a first visit.
    expect((await a.http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-03', '11:00'), promoCode: 'SINGLE' })).status).toBe(201);
    expect(await why(b.http, 'SINGLE')).toEqual({ promoCode: 'used_up' });
    expect((await a.http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-04', '11:00'), promoCode: 'STUDIO10' })).status).toBe(201);
    expect(await why(a.http, 'STUDIO10', { start: at('2026-06-05', '11:00') })).toEqual({ promoCode: 'used_by_you' });
    // `a` already has a visit booked on the 3rd: the 5th isn't their first; the 2nd would be.
    expect(await why(a.http, 'WELCOME', { start: at('2026-06-05', '11:00') })).toEqual({ promoCode: 'first_visit' });
    expect((await check(a.http, { code: 'WELCOME', start: tuesday })).status).toBe(200);
    const stamped = await client(1); // a stamp added by hand = a visit before the app
    expect(await why(stamped.http, 'WELCOME')).toEqual({ promoCode: 'first_visit' });
  });

  it('quotes what a code takes off, on the services it covers', async () => {
    const { http } = await client();
    const start = at('2026-06-02', '14:00');
    const pct = await check(http, { code: 'frenchonly', start, serviceIds: [gelId, frenchId] });
    expect(pct.status).toBe(200);
    expect(pct.body.promo).toEqual({
      code: 'FRENCHONLY',
      kind: 'percent',
      value: 20,
      discount: 6,
      total: 330,
      coveredTotal: 30,
      serviceIds: [frenchId],
      staffId: null,
    });
    const amount = await check(http, { code: 'BIGVISIT', start, serviceIds: [gelId, frenchId, gelId] });
    expect(amount.status).toBe(422); // the same service twice counts once: 330 < 500
    expect((await check(http, { code: 'studio10', start, serviceIds: [gelId, frenchId] })).body.promo).toMatchObject({ discount: 33, total: 330, serviceIds: null });
  });

  it('lets the desk check a code for a new client', async () => {
    const q = new URLSearchParams({ code: 'WELCOME', serviceIds: gelId, staffId: alinaId, start: at('2026-06-02', '16:00') });
    const res = await reception.get(`/api/admin/promo/check?${q.toString()}`);
    expect(res.status).toBe(200);
    expect(res.body.promo).toMatchObject({ code: 'WELCOME', discount: 45 });
  });
});

describe('booking with a code', () => {
  it('saves the discount on the booking and shows it to the client and the staff', async () => {
    await createCode(owner, { code: 'SHOWME', kind: 'percent', value: 20 });
    const { http } = await client();
    const res = await http.post('/api/appointments', { serviceIds: [gelId, frenchId], start: at('2026-06-08', '11:00'), promoCode: 'show-me' });
    expect(res.status).toBe(201);
    expect(res.body.appointment).toMatchObject({ totalPrice: 330, promo: { code: 'SHOWME', kind: 'percent', value: 20, discount: 66, applied: true } });
    const staffView = await owner.get(`/api/admin/appointments/${res.body.appointment.id}`);
    expect(staffView.body.appointment.promo).toMatchObject({ code: 'SHOWME', discount: 66 });
    expect(await uses('SHOWME')).toBe(1);
    const audit = (await owner.get('/api/admin/audit')).body.logs.find((l: { targetId: string }) => l.targetId === res.body.appointment.id);
    expect(audit).toMatchObject({ action: 'appointment.create', meta: { promo: 'SHOWME' } });
    // A code that doesn't apply refuses the booking and holds nothing.
    const refused = await http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-08', '15:00'), promoCode: 'MAYONLY' });
    expect(refused.body.error).toMatchObject({ code: 'PROMO_INVALID', fields: { promoCode: 'expired' } });
    expect(await ctx.deps.col.appointments.countDocuments({ start: new Date(at('2026-06-08', '15:00')) })).toBe(0);
  });

  it('allows one use per client, and gives it back when the booking is cancelled', async () => {
    await createCode(owner, { code: 'PERCLIENT', kind: 'amount', value: 40 });
    const { http } = await client();
    const first = await http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-09', '11:00'), promoCode: 'PERCLIENT' });
    expect(first.status).toBe(201);
    const second = await http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-10', '11:00'), promoCode: 'PERCLIENT' });
    expect(second.body.error.fields).toEqual({ promoCode: 'used_by_you' });

    const cancelled = await http.post(`/api/appointments/${first.body.appointment.id}/cancel`, {});
    expect(cancelled.body.appointment).toMatchObject({ status: 'cancelled', promo: { code: 'PERCLIENT', applied: false } });
    expect(await uses('PERCLIENT')).toBe(0);
    expect((await http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-10', '11:00'), promoCode: 'PERCLIENT' })).status).toBe(201);
  });

  it('gives the last use to exactly one of two bookings made at the same moment', async () => {
    await createCode(owner, { code: 'LASTONE', kind: 'percent', value: 25, maxUses: 1 });
    const a = await client();
    const b = await client();
    const results = await Promise.all([
      a.http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-11', '11:00'), promoCode: 'LASTONE' }),
      b.http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-11', '15:00'), promoCode: 'LASTONE' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(results.find((r) => r.status === 422)!.body.error.fields).toEqual({ promoCode: 'used_up' });
    expect(await uses('LASTONE')).toBe(1);
    expect(await ctx.deps.col.appointments.countDocuments({ 'promo.code': 'LASTONE' })).toBe(1);
  });

  it('gives the use back on a no-show, takes it again on restore, and drops the code with a note when it is gone', async () => {
    await createCode(owner, { code: 'CYCLE', kind: 'amount', value: 50, maxUses: 1 });
    const a = await client();
    const b = await client();
    const booked = await a.http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-12', '11:00'), promoCode: 'CYCLE' });
    const id = booked.body.appointment.id;

    // Cancelled by the studio: the use is free; restored: taken again.
    expect((await owner.patch(`/api/admin/appointments/${id}`, { status: 'cancelled' })).body.appointment.promo).toMatchObject({ applied: false });
    expect(await uses('CYCLE')).toBe(0);
    const restored = await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed' });
    expect(restored.body.appointment.promo).toMatchObject({ code: 'CYCLE', applied: true });
    expect(await uses('CYCLE')).toBe(1);
    expect((await check(b.http, { code: 'CYCLE', start: at('2026-06-15', '11:00') })).body.error.fields).toEqual({ promoCode: 'used_up' });

    // A no-show gives it back; someone else takes it; the visit reopened can't have it any more.
    await clock(at('2026-06-12', '14:00'), a.http, b.http);
    expect((await owner.patch(`/api/admin/appointments/${id}`, { status: 'no_show' })).status).toBe(200);
    expect(await uses('CYCLE')).toBe(0);
    expect((await b.http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-15', '11:00'), promoCode: 'CYCLE' })).status).toBe(201);
    const reopened = await owner.patch(`/api/admin/appointments/${id}`, { status: 'confirmed' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.appointment.promo).toBeNull();
    expect(reopened.body.appointment.promoRemoved).toMatchObject({ code: 'CYCLE', reason: 'used_up' });
    expect((await a.http.get(`/api/appointments/${id}`)).body.appointment.promoRemoved).toMatchObject({ code: 'CYCLE', reason: 'used_up' });
    expect(await uses('CYCLE')).toBe(1);
    await clock('2026-06-01T06:00:00Z', a.http, b.http);
  });

  it('keeps the code on a move it still covers, and drops it with a note otherwise', async () => {
    await createCode(owner, { code: 'EARLYJUNE', kind: 'percent', value: 10, endsAt: '2026-06-17' });
    const { http } = await client();
    const booked = await http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-16', '11:00'), promoCode: 'EARLYJUNE' });
    const id = booked.body.appointment.id;

    const kept = await http.post(`/api/appointments/${id}/reschedule`, { start: at('2026-06-17', '11:00') });
    expect(kept.body.appointment.promo).toMatchObject({ code: 'EARLYJUNE', discount: 30 });
    // The app asks before the move: the code wouldn't cover the 18th.
    const preview = await check(http, { code: 'EARLYJUNE', start: at('2026-06-18', '11:00'), exclude: id });
    expect(preview.body.error.fields).toEqual({ promoCode: 'expired', endsAt: '2026-06-17' });
    const moved = await http.post(`/api/appointments/${id}/reschedule`, { start: at('2026-06-18', '11:00') });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment.promo).toBeNull();
    expect(moved.body.appointment.promoRemoved).toMatchObject({ code: 'EARLYJUNE', reason: 'expired' });
    expect(await uses('EARLYJUNE')).toBe(0);
  });

  it('works only on its master\'s bookings: "any master" goes to them, a move away drops it', async () => {
    const { id: clientId, http } = await client();
    // Both masters are free at 11:00; the code is Maria's, so the booking is hers.
    const anyMaster = await http.post('/api/appointments', { serviceIds: [gelId], start: at('2026-06-19', '11:00'), promoCode: 'FORMARIA' });
    expect(anyMaster.status).toBe(201);
    expect(anyMaster.body.appointment.staff.id).toBe(mariaId);
    const other = await client();
    const withAlina = await other.http.post('/api/appointments', { serviceIds: [gelId], staffId: alinaId, start: at('2026-06-19', '15:00'), promoCode: 'FORMARIA' });
    expect(withAlina.body.error.fields).toEqual({ promoCode: 'master', master: 'Maria' });

    // The studio moves the visit to Alina: the code comes off.
    const moved = await owner.post(`/api/admin/appointments/${anyMaster.body.appointment.id}/reschedule`, { start: at('2026-06-19', '11:00'), staffId: alinaId });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment).toMatchObject({ staff: { id: alinaId }, promo: null, promoRemoved: { code: 'FORMARIA', reason: 'master' } });
    expect(await uses('FORMARIA')).toBe(0);

    // The desk can book with a code too.
    const desk = await owner.post('/api/admin/appointments', { clientId, serviceIds: [gelId], start: at('2026-06-22', '11:00'), promoCode: 'MARIA5' });
    expect(desk.status).toBe(201);
    expect(desk.body.appointment).toMatchObject({ staff: { id: mariaId }, promo: { code: 'MARIA5', discount: 60 } });
  });
});

describe('promo codes and the loyalty card', () => {
  // Three stamps added by hand: the next visit is the 4th on the card, 15% off (45 MDL on 300).
  async function fourthVisit(code: string, date: string) {
    const c = await client(3);
    const res = await owner.post('/api/admin/appointments', { clientId: c.id, serviceIds: [gelId], start: at(date, '11:00'), promoCode: code, force: true });
    expect(res.status).toBe(201);
    return { ...c, id: res.body.appointment.id as string, appointment: res.body.appointment };
  }

  it('never adds the two up: the bigger loyalty discount wins and the code gets its use back', async () => {
    await createCode(owner, { code: 'SMALL10', kind: 'percent', value: 10 });
    const visit = await fourthVisit('SMALL10', '2026-06-23');
    // Expected before the visit: loyalty 45 beats the code's 30.
    const before = await owner.get(`/api/admin/appointments/${visit.id}`);
    expect(before.body.appointment.loyalty).toMatchObject({ visit: 4, percent: 15, discount: 45, predicted: true });
    expect(before.body.appointment.promo).toMatchObject({ code: 'SMALL10', discount: 30, applied: false });

    await clock(at('2026-06-23', '14:00'), visit.http);
    const done = await owner.patch(`/api/admin/appointments/${visit.id}`, { status: 'completed' });
    expect(done.body.appointment.loyalty).toMatchObject({ visit: 4, percent: 15, discount: 45, predicted: false });
    expect(done.body.appointment.promo).toMatchObject({ code: 'SMALL10', applied: false });
    expect(await uses('SMALL10')).toBe(0);
    expect((await visit.http.get('/api/loyalty')).body.loyalty.history).toEqual([expect.objectContaining({ appointmentId: visit.id, percent: 15 })]);

    // A tie goes to the loyalty card too, so the client keeps the code.
    await clock('2026-06-01T06:00:00Z', visit.http);
    await createCode(owner, { code: 'TIE45', kind: 'amount', value: 45 });
    const tie = await fourthVisit('TIE45', '2026-06-24');
    await clock(at('2026-06-24', '14:00'), tie.http);
    expect((await owner.patch(`/api/admin/appointments/${tie.id}`, { status: 'completed' })).body.appointment.promo.applied).toBe(false);
    expect(await uses('TIE45')).toBe(0);
    await clock('2026-06-01T06:00:00Z', tie.http);
  });

  it('a bigger code wins, keeps its use, and the loyalty card does not count a discount it did not give', async () => {
    await createCode(owner, { code: 'BIG20', kind: 'percent', value: 20 });
    const visit = await fourthVisit('BIG20', '2026-06-25');
    expect(visit.appointment.promo).toMatchObject({ discount: 60, applied: true });

    await clock(at('2026-06-25', '14:00'), visit.http);
    const done = await owner.patch(`/api/admin/appointments/${visit.id}`, { status: 'completed' });
    expect(done.body.appointment.promo).toMatchObject({ code: 'BIG20', discount: 60, applied: true });
    expect(done.body.appointment.loyalty).toMatchObject({ visit: 4, percent: 15 }); // the stamp still counts
    expect(await uses('BIG20')).toBe(1);
    const card = (await visit.http.get('/api/loyalty')).body.loyalty;
    expect(card).toMatchObject({ visits: 4, history: [] });

    // Reopened by mistake: the visit is upcoming again and still holds the code.
    const reopened = await owner.patch(`/api/admin/appointments/${visit.id}`, { status: 'confirmed' });
    expect(reopened.body.appointment.promo).toMatchObject({ code: 'BIG20', applied: true });
    expect(await uses('BIG20')).toBe(1);
    await clock('2026-06-01T06:00:00Z', visit.http);
  });
});
