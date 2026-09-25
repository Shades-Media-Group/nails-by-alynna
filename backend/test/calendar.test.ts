import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, registerClient, type TestContext } from './helpers';

let ctx: TestContext;
let gelId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed();
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
