import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FitText } from './FitText';

/**
 * jsdom lays nothing out (every width is 0): give the box and its text the widths a browser
 * would measure, `text` being the text's width at full size on one line.
 */
function layOut({ box, text }: { box: number; text: number }) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-fit-text') ? box : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement?.hasAttribute('data-fit-text') ? text : 0;
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
});

const scaleOf = (text: HTMLElement) => text.style.getPropertyValue('--fit-scale');

describe('FitText', () => {
  it('renders its children on one line, at full size when they fit', () => {
    layOut({ box: 100, text: 80 });
    render(<FitText className="text-sm">Almond</FitText>);
    const text = screen.getByText('Almond');
    expect(text.closest('[data-fit-text]')).toHaveClass('text-sm');
    expect(text).toHaveClass('whitespace-nowrap');
    expect(scaleOf(text)).toBe('1');
    expect(text).not.toHaveAttribute('data-wrap');
  });

  it('shrinks the text just enough when it is wider than its box', () => {
    layOut({ box: 60, text: 80 });
    render(<FitText>Миндаль</FitText>);
    const text = screen.getByText('Миндаль');
    // 59 / 80, a pixel short of the box: widths come rounded to whole pixels.
    expect(scaleOf(text)).toBe('0.73');
    expect(text).not.toHaveAttribute('data-wrap');
  });

  it('stops at 70% and lets longer text wrap at spaces only, never inside a word', () => {
    layOut({ box: 50, text: 100 });
    render(<FitText>Forma unghiilor</FitText>);
    const text = screen.getByText('Forma unghiilor');
    expect(scaleOf(text)).toBe('0.7');
    expect(text).toHaveAttribute('data-wrap');
    expect(text.className).toContain('data-[wrap]:[word-break:keep-all]');
    expect(text.className).toContain('data-[wrap]:[overflow-wrap:normal]');
  });

  it('measures new text again, as when the language changes', () => {
    layOut({ box: 100, text: 80 });
    const { rerender } = render(<FitText>Square</FitText>);
    expect(scaleOf(screen.getByText('Square'))).toBe('1');

    layOut({ box: 100, text: 125 });
    rerender(<FitText>Квадрат</FitText>);
    expect(scaleOf(screen.getByText('Квадрат'))).toBe('0.79');
  });

  it('leaves the text at full size when nothing is laid out', () => {
    render(<FitText>Stiletto</FitText>);
    expect(scaleOf(screen.getByText('Stiletto'))).toBe('');
  });
});
