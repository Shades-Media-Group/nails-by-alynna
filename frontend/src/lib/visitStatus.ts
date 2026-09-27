import { storage } from './storage';
import { STORAGE_KEYS } from './storageKeys';

/** How this device last saw each upcoming visit: id → status. */
export type SeenVisits = Record<string, string>;

const key = (userId: string) => `${STORAGE_KEYS.visitStatus}:${userId}`;

/** Null the first time on this device (nothing seen yet, so nothing is news). */
export function readSeenVisits(userId: string): SeenVisits | null {
  const raw = storage.getJson<SeenVisits>(key(userId));
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

/** Keeps only the visits still upcoming, so the record never grows. */
export function saveSeenVisits(
  userId: string,
  visits: ReadonlyArray<{ id: string; status: string }>,
): void {
  storage.setJson(key(userId), Object.fromEntries(visits.map((visit) => [visit.id, visit.status])));
}

/** Visits this device last saw as a request that the studio has confirmed since. */
export function newlyConfirmed<T extends { id: string; status: string }>(
  visits: readonly T[],
  seen: SeenVisits | null,
): T[] {
  if (!seen) return [];
  return visits.filter((visit) => visit.status === 'confirmed' && seen[visit.id] === 'pending');
}
