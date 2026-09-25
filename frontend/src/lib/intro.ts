import type { User } from '@/types/api';
import { storage } from './storage';

/**
 * The first-run intro plays once per client account: the API remembers it (so the Home Screen
 * app, whose storage iOS keeps apart from Safari's, doesn't replay it), and so does this device
 * for accounts that saw it before the API did. The shared demo account plays it once after
 * every sign-in: each sign-in stamps a new mark, and closing the intro records that mark.
 */
const seenKey = (userId: string) => `nba:onboarded:${userId}`;
const signInKey = (userId: string) => `nba:signed-in:${userId}`;

type IntroUser = Pick<User, 'id' | 'isDemo' | 'onboarded'>;

const signInMark = (userId: string) => storage.get(signInKey(userId)) ?? 'first';

export function introSeen(user: IntroUser): boolean {
  if (user.isDemo) return storage.get(seenKey(user.id)) === signInMark(user.id);
  return Boolean(user.onboarded) || storage.get(seenKey(user.id)) !== null;
}

/** Seen on this device but not yet known to the API (seen before the API kept track). */
export function introSeenOnlyHere(user: IntroUser): boolean {
  return !user.isDemo && !user.onboarded && storage.get(seenKey(user.id)) !== null;
}

export function markIntroSeen(user: IntroUser): void {
  storage.set(seenKey(user.id), user.isDemo ? signInMark(user.id) : new Date().toISOString());
}

/** A new sign-in of the demo account: the intro plays again (in every tab, until closed once). */
export function replayIntro(userId: string): void {
  storage.set(signInKey(userId), String(Date.now()));
}
