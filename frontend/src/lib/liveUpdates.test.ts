import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenForPushes, PUSH_MESSAGE } from './liveUpdates';

const worker = new EventTarget();
Object.defineProperty(navigator, 'serviceWorker', { value: worker, configurable: true });

afterEach(() => vi.restoreAllMocks());

describe('listenForPushes', () => {
  it("refetches the person's own data when a push arrives, never the studio's static data", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    listenForPushes(client);

    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'something-else' } }));
    expect(invalidate).not.toHaveBeenCalled();

    worker.dispatchEvent(new MessageEvent('message', { data: { type: PUSH_MESSAGE, tag: 'appt-1' } }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    const { predicate } = invalidate.mock.calls[0]![0] as unknown as { predicate: (query: { queryKey: unknown[] }) => boolean };
    expect(predicate({ queryKey: ['loyalty'] })).toBe(true);
    expect(predicate({ queryKey: ['appointments', 'upcoming'] })).toBe(true);
    expect(predicate({ queryKey: ['admin', 'appointments', {}] })).toBe(true);
    expect(predicate({ queryKey: ['catalog'] })).toBe(false);
    expect(predicate({ queryKey: ['config'] })).toBe(false);
  });
});
