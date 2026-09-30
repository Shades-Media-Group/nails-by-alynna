import { ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPhotoStorage, removeUnattachedPhotos, webpSize } from '../src/modules/photos/service';
import { createTestContext, loginAs, registerClient, strongPassword, type TestClient, type TestContext } from './helpers';

/*
 * Booking photos: a client adds up to three pictures of the nails they want. The phone sends
 * them as small WebP files; the API checks, keeps and shows them only to that client and staff.
 */

let ctx: TestContext;
let owner: TestClient;
let gelId: string;

/** A real 1×1 WebP (lossless). */
const TINY = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
/** A WebP header saying width × height (VP8X), padded to `size` bytes, as the checks read it. */
function webpOf(width: number, height: number, size = 2048): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(size - 8, 4);
  bytes.write('WEBPVP8X', 8, 'ascii');
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}
const upload = (client: TestClient, image: Buffer = webpOf(1600, 1200, 150_000), thumb: Buffer = webpOf(320, 240, 9_000)) =>
  client.post('/api/photos', { image: image.toString('base64'), thumb: thumb.toString('base64') });

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.seed({ admin: { email: 'owner@example.com', password: strongPassword, name: 'Alina', surname: 'Owner' } });
  owner = await loginAs(ctx, 'owner@example.com', strongPassword);
  const catalog = await ctx.client().get('/api/catalog');
  gelId = catalog.body.services.find((s: { slug: string }) => s.slug === 'gel-polish').id;
});
afterAll(async () => {
  await ctx.close();
});

describe('WebP check', () => {
  it('reads the size of real WebP files and nothing else', () => {
    expect(webpSize(new Uint8Array(TINY))).toEqual({ width: 1, height: 1 });
    expect(webpSize(new Uint8Array(webpOf(1600, 900)))).toEqual({ width: 1600, height: 900 });
    expect(webpSize(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')))).toBeNull();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    expect(webpSize(new Uint8Array(png))).toBeNull();
  });
});

describe('booking photos', () => {
  it('keeps a small WebP and shows it only to its client and the staff', async () => {
    const ana = await registerClient(ctx);
    const res = await upload(ana.client, TINY, TINY);
    expect(res.status).toBe(201);
    expect(res.body.photo).toMatchObject({ width: 1, height: 1, size: TINY.length * 2 });
    const { url, thumbUrl } = res.body.photo as { url: string; thumbUrl: string };

    const own = await ana.client.get(url);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/webp');
    expect(own.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(own.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await ana.client.get(thumbUrl)).status).toBe(200);
    expect((await owner.get(url)).status).toBe(200);

    const other = await registerClient(ctx);
    expect((await other.client.get(url)).status).toBe(404);
    expect((await ctx.client().get(url)).status).toBe(401);
  });

  it('refuses anything that is not a small WebP', async () => {
    const { client } = await registerClient(ctx);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await upload(client, svg)).body.error.fields).toEqual({ image: 'invalid_image' });
    expect((await upload(client, webpOf(4000, 3000))).body.error.fields).toEqual({ image: 'too_large' });
    expect((await upload(client, undefined, webpOf(1200, 900))).body.error.fields).toEqual({ thumb: 'too_large' });
    expect((await client.post('/api/photos', { image: 'not base64!', thumb: 'x' })).status).toBe(422);
    // Over the upload's own body limit.
    expect((await upload(client, webpOf(1600, 1200, 1_000_000))).status).toBe(413);
  });

  it('go with the booking: up to three of the client\'s own, seen by the master on the booking', async () => {
    const ana = await registerClient(ctx);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await upload(ana.client)).body.photo.id);
    const slots = (await ana.client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-03`)).body.slots as Array<{ start: string }>;
    const book = (photoIds: string[]) => ana.client.post('/api/appointments', { serviceIds: [gelId], start: slots[0]!.start, photoIds });

    expect((await book(ids)).body.error.fields).toEqual({ photoIds: 'too_many' });
    const others = await registerClient(ctx);
    const theirs = (await upload(others.client)).body.photo.id as string;
    expect((await book([ids[0]!, theirs])).body.error.fields).toEqual({ photoIds: 'invalid' });

    const booked = await book(ids.slice(0, 3));
    expect(booked.status).toBe(201);
    expect(booked.body.appointment.photos.map((p: { id: string }) => p.id)).toEqual(ids.slice(0, 3));
    const id = booked.body.appointment.id as string;
    expect((await ana.client.get(`/api/appointments/${id}`)).body.appointment.photos).toHaveLength(3);
    expect((await owner.get(`/api/admin/appointments/${id}`)).body.appointment.photos).toHaveLength(3);
    // A photo already on a booking can't go on another one.
    expect((await book([ids[0]!])).body.error.fields).toEqual({ photoIds: 'invalid' });

    // The client can take one back before the visit.
    expect((await ana.client.delete(`/api/photos/${ids[2]}`)).status).toBe(200);
    expect((await ana.client.get(`/api/appointments/${id}`)).body.appointment.photos).toHaveLength(2);
  });

  it('removes photos never put on a booking after a day', async () => {
    const { client } = await registerClient(ctx);
    const id = (await upload(client)).body.photo.id as string;
    expect(await removeUnattachedPhotos(ctx.deps, new Date(ctx.now().getTime() + 23 * 3_600_000))).toBe(0);
    expect(await removeUnattachedPhotos(ctx.deps, new Date(ctx.now().getTime() + 25 * 3_600_000))).toBeGreaterThanOrEqual(1);
    expect(await ctx.deps.col.photos.countDocuments({ _id: new ObjectId(id) })).toBe(0);
    expect((await client.get(`/api/photos/${id}`)).status).toBe(404);
  });

  it('lets the owner see how much room they take, find them by date or size, and delete them', async () => {
    const { client } = await registerClient(ctx);
    const big = (await upload(client, webpOf(1600, 1200, 400_000))).body.photo.id as string;
    const list = await owner.get('/api/admin/photos?sort=largest&limit=5');
    expect(list.status).toBe(200);
    expect(list.body.photos[0]).toMatchObject({ id: big, size: 409_000, client: { name: 'Ana Rusu' }, appointment: null });
    expect(list.body.storage).toMatchObject({ alertBytes: 400 * 1024 * 1024, quotaBytes: 1024 * 1024 * 1024 });
    expect(list.body.storage.count).toBe(list.body.total);

    const bigOnes = await owner.get('/api/admin/photos?minKb=300');
    expect(bigOnes.body.photos.map((p: { id: string }) => p.id)).toEqual([big]);
    const future = await owner.get('/api/admin/photos?from=2026-07-01');
    expect(future.body.total).toBe(0);
    const today = await owner.get('/api/admin/photos?from=2026-06-01&to=2026-06-01');
    expect(today.body.total).toBe(list.body.total);

    const removed = await owner.post('/api/admin/photos/delete', { ids: [big] });
    expect(removed.body).toEqual({ deleted: 1 });
    expect((await owner.get(`/api/photos/${big}`)).status).toBe(404);

    // Only the owner.
    expect((await client.get('/api/admin/photos')).status).toBe(403);
  });

  it('tells the owner when photos pass the limit, once a week', async () => {
    const { client } = await registerClient(ctx);
    await upload(client);
    const before = ctx.sentMail.filter((m) => m.to === 'owner@example.com').length;
    expect(await checkPhotoStorage(ctx.deps, 1)).toBe(true);
    await checkPhotoStorage(ctx.deps, 1);
    const mails = ctx.sentMail.filter((m) => m.to === 'owner@example.com').slice(before);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toMatch(/Fotografiile ocupă mult spațiu|Photos are taking up/);
    expect(await checkPhotoStorage(ctx.deps)).toBe(false);
  });

  it('can be added by the master booking a client at the desk, and go with that client', async () => {
    const ana = await registerClient(ctx);
    const ids = [(await upload(owner)).body.photo.id as string, (await upload(owner)).body.photo.id as string];
    const theirs = (await upload(ana.client)).body.photo.id as string;
    const slots = (await ana.client.get(`/api/availability/slots?serviceIds=${gelId}&date=2026-06-04`)).body.slots as Array<{ start: string }>;
    const book = (photoIds: string[]) =>
      owner.post('/api/admin/appointments', { clientId: ana.user.id, serviceIds: [gelId], start: slots[0]!.start, nailShape: 'almond', photoIds });

    // Only photos this staff member sent.
    expect((await book([theirs])).body.error.fields).toEqual({ photoIds: 'invalid' });
    const booked = await book(ids);
    expect(booked.status).toBe(201);
    expect(booked.body.appointment.nailShape).toBe('almond');
    const id = booked.body.appointment.id as string;
    expect((await owner.get(`/api/admin/appointments/${id}`)).body.appointment.photos).toHaveLength(2);
    // The client sees them on their booking too, and can open them; another client can't.
    expect((await ana.client.get(`/api/appointments/${id}`)).body.appointment.photos).toHaveLength(2);
    expect((await ana.client.get(`/api/photos/${ids[0]}/thumb`)).status).toBe(200);
    const stranger = await registerClient(ctx);
    expect((await stranger.client.get(`/api/photos/${ids[0]}`)).status).toBe(404);

    // They were about the client's nails: they go with the client's account.
    expect((await ana.client.delete('/api/me', { password: strongPassword })).status).toBe(200);
    expect(await ctx.deps.col.photos.countDocuments({ _id: { $in: ids.map((i) => new ObjectId(i)) } })).toBe(0);
  });

  it('go when the client deletes their account', async () => {
    const { client } = await registerClient(ctx);
    const id = (await upload(client)).body.photo.id as string;
    expect((await client.delete('/api/me', { password: strongPassword })).status).toBe(200);
    expect(await ctx.deps.col.photos.countDocuments({ _id: new ObjectId(id) })).toBe(0);
  });
});


