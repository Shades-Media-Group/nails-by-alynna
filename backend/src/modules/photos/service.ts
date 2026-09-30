import { ObjectId } from 'bson';
import type { AppDeps } from '../../context';
import type { PhotoDoc } from '../../db/types';
import { AppError } from '../../lib/errors';
import { HOUR } from '../../lib/time';
import { deliver } from '../notifications/deliver';
import { appLink } from '../notifications/content';

/*
 * Booking photos: up to three pictures a client adds to a booking, to show the nails they want.
 * The phone makes them small before they are sent (WebP at most 1600 px, about 150–200 KB, plus a
 * thumbnail of a few KB; see frontend/src/lib/photos.ts), so thousands fit in a few hundred MB.
 * Here they are only checked (a real WebP of sane size) and kept: the bytes in photo_blobs, what
 * is known about them in `photos`. Only the client who sent a photo and the staff can see it.
 */

export const PHOTO_LIMITS = {
  perBooking: 3,
  /** The phone sends 1600 px at most; a little room for older app versions. */
  maxSide: 2048,
  maxThumbSide: 640,
  maxImageBytes: 700 * 1024,
  maxThumbBytes: 96 * 1024,
} as const;

/** The owner is told when the photos take more than this (the server has 1 GB in all). */
export const STORAGE_ALERT_BYTES = 400 * 1024 * 1024;
/** What the server has in all, for the Photos page's gauge. */
export const STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;
/** A photo still not on a booking this long after it was sent is removed (the booking was never made). */
const UNATTACHED_TTL_MS = 24 * HOUR;

export interface PhotoView {
  id: string;
  /** Same-origin paths: they open with the session cookie. */
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
}

export function photoView(p: PhotoDoc): PhotoView {
  const id = p._id.toHexString();
  return { id, url: `/api/photos/${id}`, thumbUrl: `/api/photos/${id}/thumb`, width: p.width, height: p.height, size: p.size, createdAt: p.createdAt.toISOString() };
}

/**
 * Width and height of a WebP image (RIFF container: lossy VP8, lossless VP8L or extended VP8X),
 * or null when the bytes are not one. Nothing else is accepted: no SVG, HTML or anything a
 * browser could run, whatever the upload claims to be.
 */
export function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  const riffSize = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24);
  if (riffSize + 8 !== bytes.length) return null;
  const chunk = tag(12);
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return { width, height };
  }
  if (chunk === 'VP8 ') {
    // Key frame start code, then 14-bit width and height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  return null;
}

function checked(bytes: Uint8Array, maxBytes: number, maxSide: number, field: 'image' | 'thumb') {
  const size = webpSize(bytes);
  if (!size || size.width < 1 || size.height < 1) throw new AppError(422, 'VALIDATION_ERROR', 'Not a WebP image', { fields: { [field]: 'invalid_image' } });
  if (bytes.length > maxBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Photo too large', { fields: { [field]: 'too_large' } });
  if (Math.max(size.width, size.height) > maxSide) throw new AppError(422, 'VALIDATION_ERROR', 'Photo too large', { fields: { [field]: 'too_large' } });
  return size;
}

const blobs = (deps: AppDeps) => deps.db.table('photo_blobs');

/** Keeps a photo a client sent (not on a booking yet). */
export async function savePhoto(deps: AppDeps, opts: { userId: ObjectId; image: Uint8Array; thumb: Uint8Array }): Promise<PhotoDoc> {
  const size = checked(opts.image, PHOTO_LIMITS.maxImageBytes, PHOTO_LIMITS.maxSide, 'image');
  checked(opts.thumb, PHOTO_LIMITS.maxThumbBytes, PHOTO_LIMITS.maxThumbSide, 'thumb');
  const doc: PhotoDoc = {
    _id: new ObjectId(),
    userId: opts.userId,
    appointmentId: null,
    bytes: opts.image.length,
    thumbBytes: opts.thumb.length,
    size: opts.image.length + opts.thumb.length,
    width: size.width,
    height: size.height,
    createdAt: deps.now(),
  };
  // The bytes first: a photo is listed only once it can be shown.
  await deps.db.query(`INSERT INTO ${blobs(deps)} (id, image, thumb) VALUES ($1, $2, $3)`, [
    doc._id.toHexString(),
    Buffer.from(opts.image),
    Buffer.from(opts.thumb),
  ]);
  await deps.col.photos.insertOne(doc);
  return doc;
}

export async function readPhotoBytes(deps: AppDeps, id: ObjectId, which: 'image' | 'thumb'): Promise<Buffer | null> {
  const { rows } = await deps.db.query<{ data: Buffer }>(`SELECT ${which === 'thumb' ? 'thumb' : 'image'} AS data FROM ${blobs(deps)} WHERE id = $1`, [id.toHexString()]);
  return rows[0]?.data ?? null;
}

/** Removes photos and their bytes; returns how many were removed. */
export async function deletePhotos(deps: AppDeps, ids: ObjectId[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { deletedCount } = await deps.col.photos.deleteMany({ _id: { $in: ids } });
  await deps.db.query(`DELETE FROM ${blobs(deps)} WHERE id = ANY($1::text[])`, [ids.map((id) => id.toHexString())]);
  return deletedCount;
}

/**
 * The photos a client picked for a new booking: theirs, not on a booking yet, three at most.
 * Checked before the booking is made, so a wrong id never leaves a booking half done.
 */
export async function photosToAttach(deps: AppDeps, userId: ObjectId, ids: ObjectId[]): Promise<ObjectId[]> {
  const unique = [...new Map(ids.map((id) => [id.toHexString(), id])).values()];
  if (unique.length === 0) return [];
  if (unique.length > PHOTO_LIMITS.perBooking) throw new AppError(422, 'VALIDATION_ERROR', 'Too many photos', { fields: { photoIds: 'too_many' } });
  const found = await deps.col.photos.countDocuments({ _id: { $in: unique }, userId, appointmentId: null });
  if (found !== unique.length) throw new AppError(422, 'VALIDATION_ERROR', 'Photo unavailable', { fields: { photoIds: 'invalid' } });
  return unique;
}

export async function attachPhotos(deps: AppDeps, ids: ObjectId[], appointmentId: ObjectId): Promise<void> {
  if (ids.length === 0) return;
  await deps.col.photos.updateMany({ _id: { $in: ids }, appointmentId: null }, { $set: { appointmentId } });
}

/** The photos of each booking (keyed by booking id), oldest first. */
export async function photosByAppointment(deps: AppDeps, appointmentIds: ObjectId[]): Promise<Map<string, PhotoView[]>> {
  const map = new Map<string, PhotoView[]>();
  if (appointmentIds.length === 0) return map;
  const docs = await deps.col.photos.find({ appointmentId: { $in: appointmentIds } }).sort({ createdAt: 1 }).toArray();
  for (const doc of docs) {
    const key = doc.appointmentId!.toHexString();
    map.set(key, [...(map.get(key) ?? []), photoView(doc)]);
  }
  return map;
}

/** Bytes and count of every photo kept. */
export async function photoStorage(deps: AppDeps): Promise<{ bytes: number; count: number }> {
  const [row] = await deps.col.photos
    .aggregate<{ bytes: number; count: number }>([{ $group: { _id: null, bytes: { $sum: '$size' }, count: { $sum: 1 } } }])
    .toArray();
  return { bytes: row?.bytes ?? 0, count: row?.count ?? 0 };
}

const MB = 1024 * 1024;
const TEXT = {
  title: { ro: 'Fotografiile ocupă mult spațiu', ru: 'Фото занимают много места', en: 'Photos are taking up a lot of space' },
  body: {
    ro: 'Fotografiile programărilor ocupă {mb} MB din 1 GB. Șterge câteva vechi în Fotografii.',
    ru: 'Фото записей занимают {mb} МБ из 1 ГБ. Удалите старые в разделе «Фото».',
    en: 'Booking photos take {mb} MB of the 1 GB. Delete some old ones in Photos.',
  },
} as const;

/**
 * Past STORAGE_ALERT_BYTES, the owner(s) are told (in the app and by email, as their staff
 * notifications allow), at most once a week while it stays above.
 */
export async function checkPhotoStorage(deps: AppDeps, alertBytes = STORAGE_ALERT_BYTES): Promise<boolean> {
  const { bytes } = await photoStorage(deps);
  if (bytes < alertBytes) return false;
  const owners = await deps.col.users.find({ role: 'administrator', isActive: true, deletedAt: null }).toArray();
  const week = Math.floor(deps.now().getTime() / (7 * 24 * HOUR));
  const mb = String(Math.round(bytes / MB));
  await Promise.all(
    owners.map((user) => {
      const title = TEXT.title[user.locale];
      const body = TEXT.body[user.locale].replace('{mb}', mb);
      const url = appLink(deps.config.appUrl, user.locale, '/admin/photos');
      return deliver(deps, {
        key: `photos-storage:${week}:${user._id.toHexString()}`,
        kind: 'custom',
        category: 'staffBookings',
        user,
        email: () => ({ to: user.email, toName: user.name, subject: title, text: `${body}\n\n${url}`, html: `<p>${body}</p><p><a href="${url}">${url}</a></p>` }),
        push: { payload: { title, body, url, tag: 'photos-storage', lang: user.locale }, options: { ttlSec: 7 * 86_400, urgency: 'normal', topic: 'photos-storage' } },
      });
    }),
  );
  return true;
}

/** Removes the photos sent for bookings that were never made. */
export async function removeUnattachedPhotos(deps: AppDeps, now = deps.now()): Promise<number> {
  const stale = await deps.col.photos
    .find({ appointmentId: null, createdAt: { $lt: new Date(now.getTime() - UNATTACHED_TTL_MS) } }, { projection: { _id: 1 }, limit: 500 })
    .toArray();
  return deletePhotos(deps, stale.map((p) => p._id));
}
