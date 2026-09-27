import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockItArt } from './ClockItArt';

function motion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<ClockItArt>', () => {
  it('draws the hand in the three frames of the tap, five long nails and the spark, and buzzes along with the taps', () => {
    motion(false);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const { container } = render(<ClockItArt />);

    // The thumb resting, halfway and down: the resting one on top, over the nails, so each
    // fingertip covers its nail's base.
    const frames = [...container.querySelectorAll('.clock-it-frame')];
    expect(frames.map((frame) => frame.getAttribute('href'))).toEqual([
      expect.stringMatching(/hand-open\.webp/),
      expect.stringMatching(/hand-mid\.webp/),
      expect.stringMatching(/hand\.webp/),
    ]);
    const layers = [...container.querySelector('.clock-it-hand')!.children];
    expect(layers.indexOf(frames[0]!)).toBeGreaterThan(
      layers.indexOf(container.querySelector('.clock-it-thumb')!),
    );

    // Each nail: polish, the finger's shadow, a gloss and an edge. The thumb's turns with it.
    expect(container.querySelectorAll('.clock-it-thumb path')).toHaveLength(4);
    expect(container.querySelectorAll('.clock-it-hand > path:not(.clock-it-spark)')).toHaveLength(
      16,
    );
    expect(container.querySelector('.clock-it-spark')).not.toBeNull();
    expect(vibrate).toHaveBeenCalledWith([0, 470, 12, 378, 12, 378, 12]);
  });

  it('gives every drawing its own gradients', () => {
    motion(false);
    const { container } = render(
      <>
        <ClockItArt />
        <ClockItArt />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps still (no buzz) for people who switched motion off', () => {
    motion(true);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    render(<ClockItArt />);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
