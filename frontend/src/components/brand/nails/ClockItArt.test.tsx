import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockItArt } from './ClockItArt';

function motion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<ClockItArt>', () => {
  it('draws the whole hand, the tapping thumb and middle finger and the spark, and buzzes along with the taps', () => {
    motion(false);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const { container } = render(<ClockItArt />);
    expect(container.querySelector('.clock-it-thumb')).not.toBeNull();
    expect(container.querySelector('.clock-it-middle')).not.toBeNull();
    expect(container.querySelector('.clock-it-spark')).not.toBeNull();
    // The whole hand: five fingers, each with its nail and gloss, then the palm and the pearls.
    expect(container.querySelectorAll('.clock-it-thumb path, .clock-it-middle path')).toHaveLength(6);
    expect(container.querySelectorAll('svg > path').length).toBeGreaterThanOrEqual(12);
    expect(container.querySelectorAll('circle')).toHaveLength(6);
    expect(vibrate).toHaveBeenCalledWith([0, 470, 12, 378, 12, 378, 12]);
  });

  it('keeps still (no buzz) for people who switched motion off', () => {
    motion(true);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    render(<ClockItArt />);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
