import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetConsentForTests,
  acceptAll,
  acceptMinimal,
  CONSENT_MAX_AGE_MS,
  CONSENT_VERSION,
  hasConsent,
  readConsent,
  saveConsent,
} from './consent';
import { STORAGE_KEYS } from './storage';

beforeEach(() => {
  localStorage.clear();
  __resetConsentForTests();
});

describe('consent store', () => {
  it('starts undecided with every optional category off', () => {
    expect(readConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
    expect(hasConsent('preferences')).toBe(false);
  });

  it('accept all / minimal persist the right choices', () => {
    acceptAll();
    expect(hasConsent('analytics')).toBe(true);
    expect(hasConsent('preferences')).toBe(true);
    expect(readConsent()).toMatchObject({ version: CONSENT_VERSION, analytics: true, preferences: true });

    acceptMinimal();
    expect(hasConsent('analytics')).toBe(false);
    expect(readConsent()).toMatchObject({ analytics: false, preferences: false });
  });

  it('saves a custom choice', () => {
    saveConsent({ preferences: true, analytics: false });
    expect(readConsent()).toMatchObject({ preferences: true, analytics: false });
  });

  it('withdrawing preferences deletes what that category stored', () => {
    localStorage.setItem(STORAGE_KEYS.installDismissed, '1');
    localStorage.setItem(STORAGE_KEYS.bookingDraft, '{}');
    saveConsent({ preferences: false, analytics: true });
    expect(localStorage.getItem(STORAGE_KEYS.installDismissed)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.bookingDraft)).toBeNull();
  });

  it('asks again after six months or a policy version change', () => {
    const old = new Date(Date.now() - CONSENT_MAX_AGE_MS - 1000).toISOString();
    localStorage.setItem(STORAGE_KEYS.consent, JSON.stringify({ version: CONSENT_VERSION, preferences: true, analytics: true, decidedAt: old }));
    expect(readConsent()).toBeNull();
    localStorage.setItem(
      STORAGE_KEYS.consent,
      JSON.stringify({ version: CONSENT_VERSION + 1, preferences: true, analytics: true, decidedAt: new Date().toISOString() }),
    );
    expect(readConsent()).toBeNull();
  });

  it('ignores tampered values', () => {
    localStorage.setItem(STORAGE_KEYS.consent, '{"version":1,"analytics":"yes","decidedAt":"nope"}');
    expect(readConsent()).toBeNull();
  });
});
