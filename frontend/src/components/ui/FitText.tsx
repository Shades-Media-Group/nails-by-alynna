import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { cx } from '@/lib/cx';

/** However tight the box, text never gets smaller than this. */
const MIN_FONT_PX = 11;

interface FitTextProps {
  children: ReactNode;
  /** Classes for the box: its font size is the full size of the text. */
  className?: string;
  /** The smallest the text may get, as a share of the box's font size. */
  minScale?: number;
}

/**
 * A short label on one line that shrinks just enough to fit its box, instead of breaking in the
 * middle of a word ("Квадр/ат" on a 320px phone). Only the text scales, down to `minScale` and
 * never below 11px; the box keeps its full font size, so a row of labels keeps one line height.
 * Text that is still too wide at the smallest size wraps at spaces, never inside a word.
 *
 * The box's width must not depend on the text (a block, a stretched flex item). It is measured
 * after layout, when it is resized and once the web font has loaded; the scale goes on the text
 * as a CSS variable, so measuring never re-renders, and a width already measured is skipped.
 */
export function FitText({ children, className, minScale = 0.7 }: FitTextProps) {
  const box = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  // The box width, full font size and text of the last measurement.
  const measured = useRef('');

  const fit = useCallback(() => {
    const boxEl = box.current;
    const textEl = text.current;
    if (!boxEl || !textEl) return;
    const available = boxEl.clientWidth;
    // Nothing laid out (a hidden box, or a test's DOM): leave the text at its full size.
    if (available === 0) return;
    const base = Number.parseFloat(getComputedStyle(boxEl).fontSize) || 16;
    const key = `${available}|${base}|${textEl.textContent ?? ''}`;
    if (key === measured.current) return;
    measured.current = key;

    // The text's own width, at full size on one line...
    textEl.style.setProperty('--fit-scale', '1');
    delete textEl.dataset.wrap;
    const natural = textEl.scrollWidth;
    if (natural <= available) return;
    // ...then just small enough to fit. Both widths come rounded to whole pixels (a 57.5px box
    // reads 58), so aim a pixel short and round the scale down.
    const floor = Math.min(1, Math.max(minScale, MIN_FONT_PX / base));
    const scale = Math.max(floor, Math.floor(((available - 1) / natural) * 100) / 100);
    textEl.style.setProperty('--fit-scale', String(scale));
    if (natural * scale > available) textEl.dataset.wrap = '';
  }, [minScale]);

  // New text (another language) is measured before it is painted.
  useLayoutEffect(() => fit(), [children, fit]);

  useLayoutEffect(() => {
    const boxEl = box.current;
    if (!boxEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(boxEl);
    // The web font replaces the fallback font after the first paint, with other widths.
    let active = true;
    void document.fonts?.ready.then(() => {
      if (!active) return;
      measured.current = '';
      fit();
    });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [fit]);

  return (
    <span ref={box} data-fit-text="" className={cx('block min-w-0', className)}>
      <span
        ref={text}
        className="inline-block whitespace-nowrap [font-size:calc(1em*var(--fit-scale,1))] data-[wrap]:whitespace-normal data-[wrap]:[overflow-wrap:normal] data-[wrap]:[word-break:keep-all]"
      >
        {children}
      </span>
    </span>
  );
}
