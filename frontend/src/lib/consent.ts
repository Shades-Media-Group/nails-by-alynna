import { useSyncExternalStore } from 'react';
import { storage, STORAGE_KEYS } from './storage';

/**
 * Cookie / storage consent — first-party, no third-party consent service.
 * GDPR and Moldova's personal-data law (Law 133/2011 and its GDPR-aligned successor):
 * - Essential storage (session cookies, security, language, this choice) needs no consent.
 * - Optional categories default to OFF; nothing optional is stored or loaded before opt-in.
 * - The choice is asked again after 6 months or when the policy version changes.
 */

export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_MS = 182 * 24 * 60 * 60 * 1000;

export type OptionalCategory = 'preferences' | 'analytics';
export const OPTIONAL_CATEGORIES: OptionalCategory[] = ['preferences', 'analytics'];

export interface ConsentChoice {
  version: number;
  preferences: boolean;
  analytics: boolean;
  decidedAt: string;
}

export type ConsentMode = 'hidden' | 'banner' | 'custom';

const listeners = new Set<() => void>();

export function readConsent(now = Date.now()): ConsentChoice | null {
  const saved = storage.getJson<Partial<ConsentChoice>>(STORAGE_KEYS.consent);
  if (!saved || saved.version !== CONSENT_VERSION || typeof saved.decidedAt !== 'string') return null;
  const decided = new Date(saved.decidedAt).getTime();
  if (!Number.isFinite(decided) || now - decided > CONSENT_MAX_AGE_MS) return null;
  return {
    version: CONSENT_VERSION,
    preferences: saved.preferences === true,
    analytics: saved.analytics === true,
    decidedAt: saved.decidedAt,
  };
}

let current: ConsentChoice | null = typeof window === 'undefined' ? null : readConsent();
let customOpen = false;

function emit() {
  listeners.forEach((listener) => listener());
}

export function saveConsent(choice: Record<OptionalCategory, boolean>): ConsentChoice {
  current = { version: CONSENT_VERSION, ...choice, decidedAt: new Date().toISOString() };
  storage.setJson(STORAGE_KEYS.consent, current);
  customOpen = false;
  // Withdrawn preferences: forget what that category stored.
  if (!choice.preferences) {
    storage.remove(STORAGE_KEYS.installDismissed);
    storage.remove(STORAGE_KEYS.bookingDraft);
  }
  emit();
  return current;
}

export const acceptAll = () => saveConsent({ preferences: true, analytics: true });
export const acceptMinimal = () => saveConsent({ preferences: false, analytics: false });

/** Re-open the banner in "custom" mode (Profile → Privacy, footer link). */
export function openConsentSettings(): void {
  customOpen = true;
  emit();
}

export function closeConsentSettings(): void {
  customOpen = false;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface Snapshot {
  choice: ConsentChoice | null;
  mode: ConsentMode;
}
let snapshot: Snapshot = { choice: current, mode: current ? 'hidden' : 'banner' };
function getSnapshot(): Snapshot {
  const mode: ConsentMode = customOpen ? 'custom' : current ? 'hidden' : 'banner';
  if (snapshot.choice !== current || snapshot.mode !== mode) snapshot = { choice: current, mode };
  return snapshot;
}

export function useConsent() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Gate for optional features: `if (hasConsent('analytics')) loadStats()`. */
export function hasConsent(category: OptionalCategory): boolean {
  return Boolean(current?.[category]);
}

/** Test helper: reload state from storage. */
export function __resetConsentForTests(): void {
  current = readConsent();
  customOpen = false;
  emit();
}
