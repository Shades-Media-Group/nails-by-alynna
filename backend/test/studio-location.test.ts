import { ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppointmentDoc } from '../src/db/types';
import { visitInfo } from '../src/modules/notifications/content';
import { getSettings } from '../src/modules/settings';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * The studio's pin (Admin → Settings), which "Getting there" on Home hands to Google Maps, Apple
 * Maps, Waze and Yandex Go; and a client's visit history at a glance.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let ctx: TestContext;
let owner: TestClient;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Olga', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
});
afterAll(async () => {
  await ctx.close();
});

describe("the studio's pin", () => {
  it('is the studio in Chișinău until the owner moves it, and every client sees it', async () => {
    const config = await ctx.client().get('/api/config');
    expect(config.body.studio.location).toEqual({ lat: 47.063205, lng: 28.844794 });
  });

  it('is saved from Settings, to six decimals, and only on the map', async () => {
    const saved = await owner.patch('/api/admin/settings', { location: { lat: 47.0512345678, lng: 28.8765432109 } });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.location).toEqual({ lat: 47.051235, lng: 28.876543 });

    for (const location of [{ lat: 91, lng: 28 }, { lat: 47, lng: -181 }, { lat: '47', lng: 28 }, null]) {
      const res = await owner.patch('/api/admin/settings', { location });
      expect(res.status, JSON.stringify(location)).toBe(422);
    }
    const { client } = await registerClient(ctx);
    expect((await client.patch('/api/admin/settings', { location: { lat: 1, lng: 1 } })).status).toBe(403);

    await owner.patch('/api/admin/settings', { location: { lat: 47.063205, lng: 28.844794 } });
  });

  it('gives visit emails directions to the pin when there is no map link, and calendar files a GEO', async () => {
    const settings = await getSettings(ctx.deps);
    const appointment = { _id: new ObjectId(), code: 'ABC123', start: new Date(), status: 'confirmed', services: [] } as unknown as AppointmentDoc;
    const info = visitInfo(appointment, { appUrl: 'https://app.example', locale: 'en', settings, master: null, hasAccount: true });
    expect(info.directionsUrl).toBe('https://www.google.com/maps/dir/?api=1&destination=47.063205,28.844794');
    const withLink = visitInfo(appointment, {
      appUrl: 'https://app.example',
      locale: 'en',
      settings: { ...settings, mapsUrl: 'https://maps.app.goo.gl/studio' },
      master: null,
      hasAccount: true,
    });
    expect(withLink.directionsUrl).toBe('https://maps.app.goo.gl/studio');

    const { client } = await registerClient(ctx);
    const catalog = await ctx.client().get('/api/catalog');
    const gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
    const slots = await client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-02`);
    const booked = await client.post('/api/appointments', { serviceIds: [gelId], start: slots.body.slots[0].start });
    expect(booked.status).toBe(201);
    const ics = await (await ctx.app.request(new URL(booked.body.appointment.calendarUrl).pathname)).text();
    expect(ics).toContain('\r\nGEO:47.063205;28.844794\r\n');
  });
});

describe('visit history at a glance', () => {
  it('counts the visits done and says when the first one was', async () => {
    const registered = await registerClient(ctx);
    const empty = await registered.client.get('/api/appointments/summary');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ visits: 0, firstVisitAt: null });

    const staffId = (await ctx.deps.col.staff.findOne({ name: 'Alina' }))!._id;
    const clientId = new ObjectId(registered.user.id);
    const visit = (daysAgo: number, status: AppointmentDoc['status']): AppointmentDoc => {
      const start = new Date(ctx.now().getTime() - daysAgo * DAY);
      return {
        _id: new ObjectId(),
        code: Math.random().toString(36).slice(2, 8).toUpperCase(),
        clientId,
        client: { name: 'Ana', surname: 'Rusu', phone: null, email: 'ana@example.com' },
        staffId,
        services: [],
        start,
        end: new Date(start.getTime() + 90 * MIN),
        durationMin: 90,
        totalPrice: 300,
        priceFrom: false,
        status,
        notes: '',
        staffNotes: '',
        source: 'client',
        placedAt: start,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: '',
        createdBy: clientId,
        createdAt: start,
        updatedAt: start,
      };
    };
    const first = visit(120, 'completed');
    // A confirmed visit whose time is over took place, even if nobody marked it done. Visits
    // that never happened, a request never confirmed, one still to come and someone else's
    // don't count.
    await ctx.deps.col.appointments.insertMany([
      first,
      visit(60, 'completed'),
      visit(30, 'confirmed'),
      visit(200, 'cancelled'),
      visit(10, 'no_show'),
      visit(5, 'pending'),
      visit(-3, 'confirmed'),
      { ...visit(300, 'completed'), clientId: new ObjectId() },
    ]);

    const summary = await registered.client.get('/api/appointments/summary');
    expect(summary.body).toEqual({ visits: 3, firstVisitAt: first.start.toISOString() });
    expect((await ctx.client().get('/api/appointments/summary')).status).toBe(401);
  });
});
