import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  nextReward,
  normalizeMemberCode,
  positionAfter,
  rulesFrom,
  stampFor,
  type LoyaltyRules,
} from '../src/modules/loyalty/service';
import { DEFAULT_SETTINGS } from '../src/modules/settings';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

const rules: LoyaltyRules = rulesFrom(DEFAULT_SETTINGS);

describe('loyalty card maths (4th visit −15%, 8th −30%)', () => {
  it('numbers visits on an 8-stamp card and starts a new card after the 8th', () => {
    expect(positionAfter(rules, 0)).toBe(1);
    expect(positionAfter(rules, 3)).toBe(4);
    expect(positionAfter(rules, 7)).toBe(8);
    expect(positionAfter(rules, 8)).toBe(1);
    expect(positionAfter(rules, 11)).toBe(4);
  });

  it('puts the discount on the right visits', () => {
    expect(stampFor(rules, 2, 400)).toEqual({ visit: 3, cycle: 8, percent: 0, discount: 0 });
    expect(stampFor(rules, 3, 400)).toEqual({ visit: 4, cycle: 8, percent: 15, discount: 60 });
    expect(stampFor(rules, 7, 450)).toEqual({ visit: 8, cycle: 8, percent: 30, discount: 135 });
    expect(stampFor(rules, 15, 300)).toMatchObject({ visit: 8, percent: 30, discount: 90 });
  });

  it('tells how far the next discount is', () => {
    expect(nextReward(rules, 0)).toEqual({ visit: 4, percent: 15, inVisits: 4 });
    expect(nextReward(rules, 3)).toEqual({ visit: 4, percent: 15, inVisits: 1 });
    expect(nextReward(rules, 4)).toEqual({ visit: 8, percent: 30, inVisits: 4 });
    expect(nextReward(rules, 8)).toEqual({ visit: 4, percent: 15, inVisits: 4 });
    expect(nextReward({ ...rules, rewards: [] }, 3)).toBeNull();
  });

  it('reads member codes from a QR URL or a typed code', () => {
    expect(normalizeMemberCode('K7QM2XRP')).toBe('K7QM2XRP');
    expect(normalizeMemberCode('k7qm 2xrp')).toBe('K7QM2XRP');
    expect(normalizeMemberCode('K7QM-2XRP')).toBe('K7QM2XRP');
    expect(normalizeMemberCode('https://nailsbyalynna.md/c/K7QM2XRP')).toBe('K7QM2XRP');
    expect(normalizeMemberCode('K7QM2XR')).toBeNull();
    expect(normalizeMemberCode('K7QM2XR0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeMemberCode('<script>')).toBeNull();
  });
});

describe('loyalty over the API', () => {
  let ctx: TestContext;
  let owner: TestClient;
  let client: TestClient;
  let clientId: string;
  let gelId: string;
  let price: number;

  beforeAll(async () => {
    ctx = await createTestContext();
    ctx.setNow(new Date('2026-06-01T06:00:00Z'));
    await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
    owner = await loginAs(ctx, 'owner@example.com', strongPassword);
    const catalog = await ctx.client().get('/api/catalog');
    const gel = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish');
    gelId = gel.id;
    price = gel.price;
    const registered = await registerClient(ctx, { email: 'loyal@example.com' });
    client = registered.client;
    clientId = registered.user.id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  // One visit per weekday morning (Chișinău 12:00), all booked ahead of time.
  const days = ['02', '03', '04', '05', '06', '09', '10', '11', '12'];
  const startOf = (i: number) => `2026-06-${days[i]}T09:00:00.000Z`;
  const ids: string[] = [];

  async function book(i: number) {
    const res = await owner.post('/api/admin/appointments', { clientId, serviceIds: [gelId], start: startOf(i), force: true });
    expect(res.status).toBe(201);
    ids.push(res.body.appointment.id);
    return res.body.appointment;
  }

  /** Moves the clock; access tokens are short-lived, so both sessions refresh like the app does. */
  async function at(date: Date) {
    ctx.setNow(date);
    expect((await owner.post('/api/auth/refresh')).status).toBe(200);
    expect((await client.post('/api/auth/refresh')).status).toBe(200);
  }

  async function complete(i: number) {
    await at(new Date(new Date(startOf(i)).getTime() + 3 * 3_600_000));
    const res = await owner.patch(`/api/admin/appointments/${ids[i]}`, { status: 'completed' });
    expect(res.status).toBe(200);
    return res.body.appointment;
  }

  it('issues a member card with a QR link and an empty card', async () => {
    const res = await client.get('/api/loyalty');
    expect(res.status).toBe(200);
    expect(res.body.card.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(res.body.card.url).toMatch(new RegExp(`/c/${res.body.card.code}$`));
    expect(res.body.loyalty).toMatchObject({ enabled: true, cycle: 8, visits: 0, stamps: 0, card: 1 });
    expect(res.body.loyalty.nextReward).toEqual({ visit: 4, percent: 15, inVisits: 4 });
    // Same code every time.
    expect((await client.get('/api/loyalty')).body.card.code).toBe(res.body.card.code);
  });

  it('shows the discount a booking will get before the visit', async () => {
    for (let i = 0; i < 4; i++) await book(i);
    const list = await client.get('/api/appointments?scope=upcoming');
    const byId = new Map(list.body.appointments.map((a: { id: string }) => [a.id, a]));
    expect(byId.get(ids[0])).toMatchObject({ loyalty: { visit: 1, percent: 0, predicted: true } });
    expect(byId.get(ids[3])).toMatchObject({
      loyalty: { visit: 4, percent: 15, discount: Math.round(price * 0.15), predicted: true },
    });
  });

  it('stamps each completed visit and locks the 4th-visit discount', async () => {
    for (let i = 0; i < 3; i++) expect((await complete(i)).loyalty).toMatchObject({ visit: i + 1, percent: 0, predicted: false });
    const fourth = await complete(3);
    expect(fourth.loyalty).toEqual({ visit: 4, cycle: 8, percent: 15, discount: Math.round(price * 0.15), predicted: false });

    const card = await client.get('/api/loyalty');
    expect(card.body.loyalty).toMatchObject({ visits: 4, stamps: 4, nextReward: { visit: 8, percent: 30, inVisits: 4 } });
    expect(card.body.loyalty.history).toEqual([
      expect.objectContaining({ appointmentId: ids[3], visit: 4, percent: 15, discount: Math.round(price * 0.15) }),
    ]);
  });

  it('gives 30% on the 8th visit, then starts a new card', async () => {
    await at(new Date('2026-06-01T06:00:00Z'));
    for (let i = 4; i < 9; i++) await book(i);
    for (let i = 4; i < 7; i++) await complete(i);
    const eighth = await complete(7);
    expect(eighth.loyalty).toMatchObject({ visit: 8, percent: 30, discount: Math.round(price * 0.3) });
    const ninth = await complete(8);
    expect(ninth.loyalty).toMatchObject({ visit: 1, percent: 0 });
    const card = await client.get('/api/loyalty');
    expect(card.body.loyalty).toMatchObject({ visits: 9, stamps: 1, card: 2 });
  });

  it('takes the stamp back when a completion is undone', async () => {
    const undone = await owner.patch(`/api/admin/appointments/${ids[8]}`, { status: 'confirmed' });
    expect(undone.status).toBe(200);
    expect(undone.body.appointment.loyalty).toMatchObject({ visit: 1, predicted: true });
    expect((await client.get('/api/loyalty')).body.loyalty.visits).toBe(8);
  });

  it('lets staff open the card from the QR code and add a stamp by hand', async () => {
    const { code } = (await client.get('/api/loyalty')).body.card;
    const messy = `${code.slice(0, 4).toLowerCase()} ${code.slice(4)}`;
    const card = await owner.get(`/api/admin/loyalty/card/${encodeURIComponent(messy)}`);
    expect(card.status).toBe(200);
    expect(card.body.client).toMatchObject({ id: clientId, memberCode: code, hasAccount: true });
    expect(card.body.loyalty.visits).toBe(8);
    expect(card.body.appointments.map((a: { id: string }) => a.id)).toContain(ids[8]);

    const stamped = await owner.post(`/api/admin/loyalty/clients/${clientId}/stamps`, { delta: 1, reason: 'Visit before the app' });
    expect(stamped.status).toBe(200);
    expect(stamped.body.loyalty.visits).toBe(9);
    const removed = await owner.post(`/api/admin/loyalty/clients/${clientId}/stamps`, { delta: -1 });
    expect(removed.body.loyalty.visits).toBe(8);

    expect((await owner.get('/api/admin/loyalty/card/AAAAAAAA')).body.error.code).toBe('CARD_NOT_FOUND');
    expect((await owner.get('/api/admin/loyalty/card/nope')).status).toBe(404);
    // Clients never see other people's cards.
    expect((await client.get(`/api/admin/loyalty/card/${code}`)).status).toBe(403);
  });

  it('lets the owner change the rules, within the card', async () => {
    const bad = await owner.patch('/api/admin/settings', { loyaltyCycle: 6, loyaltyRewards: [{ visit: 8, percent: 50 }] });
    expect(bad.status).toBe(422);
    const ok = await owner.patch('/api/admin/settings', {
      loyaltyCycle: 6,
      loyaltyRewards: [
        { visit: 6, percent: 40 },
        { visit: 3, percent: 10 },
      ],
    });
    expect(ok.status).toBe(200);
    const config = await ctx.client().get('/api/config');
    expect(config.body.loyalty).toEqual({
      enabled: true,
      cycle: 6,
      rewards: [
        { visit: 3, percent: 10 },
        { visit: 6, percent: 40 },
      ],
    });
  });
});
