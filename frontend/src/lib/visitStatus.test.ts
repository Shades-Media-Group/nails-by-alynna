import { afterEach, describe, expect, it } from 'vitest';
import { newlyConfirmed, readSeenVisits, saveSeenVisits } from './visitStatus';

afterEach(() => window.localStorage.clear());

describe('visits seen on this device', () => {
  it('finds requests confirmed since they were last seen, and nothing the first time', () => {
    expect(readSeenVisits('u1')).toBeNull();
    expect(newlyConfirmed([{ id: 'a', status: 'confirmed' }], null)).toEqual([]);

    saveSeenVisits('u1', [
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'confirmed' },
      { id: 'c', status: 'pending' },
    ]);
    const now = [
      { id: 'a', status: 'confirmed' },
      { id: 'b', status: 'confirmed' },
      { id: 'c', status: 'pending' },
      { id: 'd', status: 'confirmed' },
    ];
    expect(newlyConfirmed(now, readSeenVisits('u1')).map((v) => v.id)).toEqual(['a']);

    // Once saved, the same confirmation is not news again.
    saveSeenVisits('u1', now);
    expect(newlyConfirmed(now, readSeenVisits('u1'))).toEqual([]);
  });

  it('keeps each person apart and forgets visits that are no longer upcoming', () => {
    saveSeenVisits('u1', [{ id: 'a', status: 'pending' }]);
    expect(readSeenVisits('u2')).toBeNull();
    saveSeenVisits('u1', []);
    expect(readSeenVisits('u1')).toEqual({});
  });
});
