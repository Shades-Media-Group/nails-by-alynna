import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, loginAs, registerClient, strongPassword, type TestContext } from './helpers';

let ctx: TestContext;
let gelId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  // The seeded owner is also the studio's first master (Alina).
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  ctx.setNow(new Date('2026-06-01T06:00:00Z'));
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
});
afterAll(async () => {
  await ctx.close();
});

describe('"Add to calendar" links', () => {
  it('gives each upcoming visit a signed .ics link that opens without signing in', async () => {
    const { client } = await registerClient(ctx);
    const slots = await client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-02`);
    const booked = await client.post('/api/appointments', { serviceIds: [gelId], start: slots.body.slots[0].start });
    expect(booked.status).toBe(201);
    const url = booked.body.appointment.calendarUrl as string;
    expect(url).toMatch(/\/api\/calendar\/[a-f0-9]{24}\.\d+\.[A-Za-z0-9_-]{43}\.ics$/);

    const path = new URL(url).pathname;
    const res = await ctx.app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/calendar/);
    expect(res.headers.get('content-disposition')).toMatch(/^inline; filename="nails-by-alynna-[A-Z0-9]{6}\.ics"$/);
    const ics = await res.text();
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain(`DTSTART:${slots.body.slots[0].start.replace(/[-:]/g, '').replace('.000', '')}`);
    expect(ics).toMatch(/SUMMARY:Nails by Alynna: /);
    expect(ics).toContain('TRIGGER:-PT1H');
    // Lines never exceed 75 octets (RFC 5545 folding).
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);

    // A changed id or signature is refused.
    const forged = path.replace(/[a-f0-9]{24}/, '0'.repeat(24));
    expect((await ctx.app.request(forged)).status).toBe(404);
    expect((await ctx.app.request(path.replace(/\.[A-Za-z0-9_-]{43}\.ics$/, `.${'A'.repeat(43)}.ics`))).status).toBe(404);
    // And the link expires a month after the visit.
    ctx.setNow(new Date('2026-08-01T06:00:00Z'));
    expect((await ctx.app.request(path)).status).toBe(404);
    ctx.setNow(new Date('2026-06-01T06:00:00Z'));
  });
});

describe('calendar sync for masters', () => {
  const unfold = (ics: string) => ics.replace(/\r\n /g, '');

  it('gives the master a private feed of their bookings that Apple, Google and Outlook subscribe to', async () => {
    const owner = await loginAs(ctx, 'owner@example.com', strongPassword);
    expect((await owner.get('/api/admin/team/me/calendar')).body).toEqual({ feed: null });

    const on = await owner.post('/api/admin/team/me/calendar');
    expect(on.status).toBe(201);
    const feed = on.body.feed as { url: string; webcal: string; google: string; outlook: string };
    expect(feed.url).toMatch(/^http:\/\/localhost:5180\/api\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(feed.webcal).toBe(feed.url.replace(/^http:/, 'webcal:'));
    expect(feed.google).toContain(encodeURIComponent(feed.webcal));
    expect(feed.outlook).toContain(`url=${encodeURIComponent(feed.webcal)}`);
    expect((await owner.get('/api/admin/team/me/calendar')).body.feed.url).toBe(feed.url);

    // A client asks for a visit, another one books and cancels.
    const ana = await registerClient(ctx, { name: 'Ana', surname: 'Rusu' });
    const slots = (await ana.client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-03`)).body.slots as Array<{ start: string }>;
    const asked = await ana.client.post('/api/appointments', { serviceIds: [gelId], start: slots[0]!.start, notes: 'Pastel, please' });
    expect(asked.status).toBe(201);
    const ion = await registerClient(ctx, { name: 'Ion', surname: 'Cancelled' });
    const gone = await ion.client.post('/api/appointments', { serviceIds: [gelId], start: slots.at(-1)!.start });
    expect((await ion.client.post(`/api/appointments/${gone.body.appointment.id}/cancel`, {})).status).toBe(200);

    // The calendar server fetches it without signing in.
    const path = new URL(feed.url).pathname;
    const res = await ctx.app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    const ics = await res.text();
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const text = unfold(ics);
    expect(text).toContain('X-WR-CALNAME:Nails by Alynna · Alina');
    expect(text).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT15M');
    expect(text).toContain(`UID:${asked.body.appointment.id}@nails-by-alynna`);
    expect(text).toMatch(/SUMMARY:Cerere: Ana Rusu · /);
    expect(text).toContain('STATUS:TENTATIVE');
    expect(text).toContain('Pastel\\, please');
    expect(text).not.toContain('Ion Cancelled');
    // Never the client's phone: a leaked link must not leak contacts.
    expect(text).not.toMatch(/\+?373|069 123 456/);

    // An unchanged feed is not sent again.
    const etag = res.headers.get('etag')!;
    const again = await ctx.app.request(path, { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);

    // Confirming the visit changes the feed (and its ETag).
    expect((await owner.patch(`/api/admin/appointments/${asked.body.appointment.id}`, { status: 'confirmed' })).status).toBe(200);
    const changed = await ctx.app.request(path, { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
    expect(unfold(await changed.text())).toMatch(/SUMMARY:Ana Rusu · [\s\S]*STATUS:CONFIRMED/);

    // A new link cuts off the old one; turning sync off cuts off the new one.
    const reset = await owner.post('/api/admin/team/me/calendar');
    expect(reset.body.feed.url).not.toBe(feed.url);
    expect((await ctx.app.request(path)).status).toBe(404);
    expect((await ctx.app.request(new URL(reset.body.feed.url as string).pathname)).status).toBe(200);
    expect((await owner.delete('/api/admin/team/me/calendar')).body).toEqual({ feed: null });
    expect((await ctx.app.request(new URL(reset.body.feed.url as string).pathname)).status).toBe(404);
  });

  it('is only for a master, about their own bookings, and never guessable', async () => {
    const { client } = await registerClient(ctx);
    expect((await client.post('/api/admin/team/me/calendar')).status).toBe(403);
    expect((await ctx.app.request(`/api/calendar/feed/${'A'.repeat(43)}.ics`)).status).toBe(404);
    expect((await ctx.app.request('/api/calendar/feed/short.ics')).status).toBe(404);
    // The team list never shows the secret.
    const owner = await loginAs(ctx, 'owner@example.com', strongPassword);
    await owner.post('/api/admin/team/me/calendar');
    expect(JSON.stringify((await owner.get('/api/admin/team/staff')).body)).not.toContain('calendarFeed');
    expect(JSON.stringify((await ctx.client().get('/api/staff')).body)).not.toContain('calendarFeed');
  });
});
