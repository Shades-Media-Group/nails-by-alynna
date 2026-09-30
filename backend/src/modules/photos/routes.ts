import { ObjectId } from 'bson';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../../context';
import { ACTIVE_STATUSES, type PhotoDoc } from '../../db/types';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { enforceRateLimits } from '../../lib/rate-limit';
import { dayRange } from '../../lib/time';
import { dateSchema, objectIdSchema, paramId, parseJson, parseQuery } from '../../lib/validation';
import { STAFF_ROLES, requireAuth, requireRole } from '../../middleware/auth';
import { getSettings } from '../settings';
import {
  STORAGE_ALERT_BYTES,
  STORAGE_QUOTA_BYTES,
  checkPhotoStorage,
  deletePhotos,
  photoStorage,
  photoView,
  readPhotoBytes,
  savePhoto,
} from './service';

/** Base64 of one file (standard alphabet), within `max` decoded bytes. */
const base64 = (max: number) =>
  z
    .string()
    .max(Math.ceil(max / 3) * 4, 'too_large')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'invalid_image')
    .transform((value) => new Uint8Array(Buffer.from(value, 'base64')));

/** The upload's own body limit (the API's usual one is 64 KB): a photo and its thumbnail, as base64 JSON. */
export const PHOTO_BODY_LIMIT = 1_300_000;

/** /api/photos — a client's photos for a booking, and the pictures themselves for whoever may see them. */
export function photoRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  /** Keeps a photo made small on the phone; it joins a booking when the booking is made (photoIds). */
  app.post('/', async (c) => {
    const user = c.get('user');
    await enforceRateLimits(deps, [{ key: `photo:user:${user._id.toHexString()}`, limit: 40, windowSec: 3600 }]);
    const input = await parseJson(c, z.object({ image: base64(700 * 1024), thumb: base64(96 * 1024) }));
    const photo = await savePhoto(deps, { userId: user._id, image: input.image, thumb: input.thumb });
    deps.defer(checkPhotoStorage(deps));
    return c.json({ photo: photoView(photo) }, 201);
  });

  /** Staff, whoever sent it, and the client whose booking it is on (a master may add them at the desk). */
  const mayView = async (photo: PhotoDoc, user: { _id: ObjectId; role: string }) => {
    if (STAFF_ROLES.includes(user.role as (typeof STAFF_ROLES)[number]) || photo.userId.equals(user._id)) return true;
    if (!photo.appointmentId) return false;
    return (await deps.col.appointments.countDocuments({ _id: photo.appointmentId, clientId: user._id })) > 0;
  };

  const serve = (which: 'image' | 'thumb') => async (c: Context<AppEnv>) => {
    const id = paramId(c);
    const photo = await deps.col.photos.findOne({ _id: id });
    if (!photo || !(await mayView(photo, c.get('user')))) throw notFound('Photo');
    const bytes = await readPhotoBytes(deps, id, which);
    if (!bytes) throw notFound('Photo');
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': 'image/webp',
      'Content-Length': String(bytes.length),
      // A photo never changes: its id is new for every upload.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `inline; filename="photo-${id.toHexString()}.webp"`,
      'X-Content-Type-Options': 'nosniff',
    });
  };
  app.get('/:id', serve('image'));
  app.get('/:id/thumb', serve('thumb'));

  /** The client takes back a photo (before the visit), or staff remove it. */
  app.delete('/:id', async (c) => {
    const user = c.get('user');
    const id = paramId(c);
    const photo = await deps.col.photos.findOne({ _id: id });
    if (!photo || !(await mayView(photo, user))) throw notFound('Photo');
    const staff = STAFF_ROLES.includes(user.role);
    if (!staff && photo.appointmentId) {
      const upcoming = await deps.col.appointments.countDocuments({
        _id: photo.appointmentId,
        status: { $in: ACTIVE_STATUSES },
        start: { $gt: deps.now() },
      });
      if (!upcoming) throw new AppError(409, 'INVALID_STATUS', 'Photos of past visits stay with the studio');
    }
    await deletePhotos(deps, [id]);
    if (staff) await audit(deps, { actorId: user._id, action: 'photo.delete', targetType: 'photo', targetId: id });
    return c.json({ ok: true });
  });

  return app;
}

/** /api/admin/photos — the owner's view of every photo kept: how much room they take, find and delete. */
export function adminPhotoRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole('administrator'));

  const listSchema = z.object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    /** Only photos at least this big (KB, photo and thumbnail together). */
    minKb: z.coerce.number().int().min(0).max(10_000).optional(),
    sort: z.enum(['newest', 'oldest', 'largest']).default('newest'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  });

  app.get('/', async (c) => {
    const q = parseQuery(c, listSchema);
    const settings = await getSettings(deps);
    const filter: Record<string, unknown> = {};
    const created: Record<string, Date> = {};
    if (q.from) created.$gte = dayRange(q.from, settings.timezone).start;
    if (q.to) created.$lt = dayRange(q.to, settings.timezone).end;
    if (Object.keys(created).length) filter.createdAt = created;
    if (q.minKb) filter.size = { $gte: q.minKb * 1024 };
    const sort: Record<string, 1 | -1> = q.sort === 'largest' ? { size: -1, createdAt: -1 } : { createdAt: q.sort === 'oldest' ? 1 : -1 };

    const [docs, total, storage] = await Promise.all([
      deps.col.photos
        .find(filter)
        .sort(sort)
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .toArray(),
      deps.col.photos.countDocuments(filter),
      photoStorage(deps),
    ]);
    const [appointments, users] = await Promise.all([
      deps.col.appointments
        .find({ _id: { $in: docs.flatMap((d) => (d.appointmentId ? [d.appointmentId] : [])) } }, { projection: { code: 1, start: 1, status: 1, client: 1 } })
        .toArray(),
      deps.col.users.find({ _id: { $in: docs.map((d) => d.userId) } }, { projection: { name: 1, surname: 1 } }).toArray(),
    ]);
    const byAppointment = new Map(appointments.map((a) => [a._id.toHexString(), a]));
    const byUser = new Map(users.map((u) => [u._id.toHexString(), u]));
    return c.json({
      photos: docs.map((d) => {
        const booking = d.appointmentId ? byAppointment.get(d.appointmentId.toHexString()) : undefined;
        const client = booking?.client ?? byUser.get(d.userId.toHexString());
        return {
          ...photoView(d),
          client: { id: d.userId.toHexString(), name: client ? [client.name, client.surname].filter(Boolean).join(' ') : '' },
          appointment: booking ? { id: booking._id.toHexString(), code: booking.code, start: booking.start.toISOString(), status: booking.status } : null,
        };
      }),
      total,
      page: q.page,
      pages: Math.max(1, Math.ceil(total / q.limit)),
      storage: { ...storage, alertBytes: STORAGE_ALERT_BYTES, quotaBytes: STORAGE_QUOTA_BYTES },
    });
  });

  /** Deletes the chosen photos (at most a page at a time). */
  app.post('/delete', async (c) => {
    const actor = c.get('user');
    const input = await parseJson(c, z.object({ ids: z.array(objectIdSchema).min(1, 'required').max(100, 'too_many') }));
    const deleted = await deletePhotos(deps, input.ids.map((id) => new ObjectId(id.toHexString())));
    await audit(deps, { actorId: actor._id, action: 'photo.delete', targetType: 'photo', targetId: null, meta: { count: deleted } });
    return c.json({ deleted });
  });

  return app;
}
