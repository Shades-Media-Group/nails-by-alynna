import { storage } from './storage';
import { STORAGE_KEYS } from './storageKeys';

const key = (userId: string) => `${STORAGE_KEYS.stamps}:${userId}`;

/** How many visits (stamps, all cards) this device last showed; null the first time. */
export function readSeenVisits(userId: string): number | null {
  const raw = storage.getJson<unknown>(key(userId));
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

export function saveSeenVisits(userId: string, visits: number): void {
  storage.setJson(key(userId), visits);
}

/** New stamps since this device last looked (0 the first time, or when one came off). */
export function newStamps(visits: number, seen: number | null): number {
  return seen === null ? 0 : Math.max(0, visits - seen);
}
