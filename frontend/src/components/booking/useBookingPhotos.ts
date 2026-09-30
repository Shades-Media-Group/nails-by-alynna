import { useEffect, useSyncExternalStore } from 'react';
import { PhotoFormatError, compressPhoto, toBase64 } from '@/lib/photos';
import { photosApi } from '@/services/api/endpoints';

export const MAX_BOOKING_PHOTOS = 3;

export interface PickedPhoto {
  key: string;
  /** What the tile shows: the picked file at first, the small thumbnail once it is ready. */
  preview: string;
  status: 'working' | 'done' | 'error';
  /** The API's id once sent. */
  id?: string;
  error?: 'format' | 'upload';
}

/**
 * The photos of the booking being put together, shared by every screen that adds them (Services
 * and the booking's own steps), so photos added on the price list are there when the booking
 * goes on, and keep sending while the client moves between screens. They belong to one account
 * and last until the booking is made (or the app is reloaded).
 */
interface Draft {
  owner: string | null;
  photos: Array<PickedPhoto & { pickedAt: number }>;
}

/** The server removes a photo not on a booking after a day; older ones here are dropped first. */
const DRAFT_MAX_AGE_MS = 20 * 60 * 60_000;

let draft: Draft = { owner: null, photos: [] };
const listeners = new Set<() => void>();
/** Object URLs by photo, freed when the photo goes. */
const urls = new Map<string, string[]>();
let counter = 0;

function commit(next: Draft) {
  draft = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => draft;

function objectUrl(key: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  urls.set(key, [...(urls.get(key) ?? []), url]);
  return url;
}
function free(key: string) {
  for (const url of urls.get(key) ?? []) URL.revokeObjectURL(url);
  urls.delete(key);
}
function update(key: string, patch: Partial<PickedPhoto>) {
  commit({ ...draft, photos: draft.photos.map((photo) => (photo.key === key ? { ...photo, ...patch } : photo)) });
}
const isHere = (key: string) => draft.photos.some((photo) => photo.key === key);

async function send(key: string, file: File) {
  try {
    const compressed = await compressPhoto(file);
    if (!isHere(key)) return;
    update(key, { preview: objectUrl(key, new Blob([compressed.thumb as BlobPart], { type: 'image/webp' })) });
    const photo = await photosApi.upload({ image: toBase64(compressed.image), thumb: toBase64(compressed.thumb) });
    // Removed while it was on its way: it goes at the studio too.
    if (!isHere(key)) {
      void photosApi.remove(photo.id).catch(() => undefined);
      return;
    }
    update(key, { status: 'done', id: photo.id });
  } catch (error) {
    if (isHere(key)) update(key, { status: 'error', error: error instanceof PhotoFormatError ? 'format' : 'upload' });
  }
}

/** Starts the next booking without photos (after one is made, and between tests). */
export function clearBookingPhotos(owner: string | null = null): void {
  for (const photo of draft.photos) free(photo.key);
  commit({ owner, photos: [] });
}

/**
 * Keeps only what this account can still use: another account's photos go, and so do ones the
 * server has cleared by now.
 */
function prune(owner: string | null) {
  const now = Date.now();
  const kept = draft.owner === owner ? draft.photos.filter((photo) => now - photo.pickedAt < DRAFT_MAX_AGE_MS) : [];
  if (draft.owner === owner && kept.length === draft.photos.length) return;
  for (const photo of draft.photos) if (!kept.includes(photo)) free(photo.key);
  commit({ owner, photos: kept });
}

/**
 * The photos a client adds to a new booking. Each one is made small and sent as soon as it is
 * picked, while the client carries on; the booking then only names them (photoIds). Removing one
 * already sent deletes it (a photo not on a booking is removed by the server after a day anyway).
 * `owner`: the signed-in account's id.
 */
export function useBookingPhotos(owner: string | null = null) {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const photos: PickedPhoto[] = state.owner === owner ? state.photos : [];
  // Opening a screen with photos: drop any this account can no longer use.
  useEffect(() => prune(owner), [owner]);

  const add = (files: FileList | File[]) => {
    prune(owner);
    const room = Math.max(0, MAX_BOOKING_PHOTOS - draft.photos.length);
    const added = [...files]
      .filter((file) => file.type === '' || file.type.startsWith('image/'))
      .slice(0, room)
      .map((file) => {
        const key = `p${++counter}`;
        return { file, photo: { key, preview: objectUrl(key, file), status: 'working' as const, pickedAt: Date.now() } };
      });
    if (added.length === 0) return;
    commit({ owner, photos: [...draft.photos, ...added.map((a) => a.photo)] });
    for (const { file, photo } of added) void send(photo.key, file);
  };

  const remove = (key: string) => {
    const photo = draft.photos.find((p) => p.key === key);
    if (photo?.id) void photosApi.remove(photo.id).catch(() => undefined);
    commit({ ...draft, photos: draft.photos.filter((p) => p.key !== key) });
    free(key);
  };

  return {
    photos,
    add,
    remove,
    /** Still being made small or sent: the booking waits for them. */
    busy: photos.some((photo) => photo.status === 'working'),
    ids: photos.flatMap((photo) => (photo.status === 'done' && photo.id ? [photo.id] : [])),
  };
}
