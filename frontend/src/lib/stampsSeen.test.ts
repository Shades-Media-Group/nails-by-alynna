import { afterEach, describe, expect, it } from 'vitest';
import { newStamps, readSeenVisits, saveSeenVisits } from './stampsSeen';

afterEach(() => window.localStorage.clear());

describe('stamps seen on this device', () => {
  it('counts the stamps added since the card was last shown here', () => {
    expect(readSeenVisits('u1')).toBeNull();
    expect(newStamps(3, null)).toBe(0);
    saveSeenVisits('u1', 3);
    expect(newStamps(3, readSeenVisits('u1'))).toBe(0);
    expect(newStamps(5, readSeenVisits('u1'))).toBe(2);
    // A stamp taken back (a visit un-completed) is not news.
    expect(newStamps(2, readSeenVisits('u1'))).toBe(0);
    expect(readSeenVisits('u2')).toBeNull();
  });
});
