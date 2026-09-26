import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cx } from '@/lib/cx';

const MIN_THUMB = 36;

/**
 * The page's scrollbar, drawn by the app: a light rounded rail fixed to the right edge with a
 * darker rounded thumb, always visible while the page is taller than the window (the browser's
 * own bar is hidden in index.css). Drag the thumb, or tap the rail to jump there; the wheel,
 * keys and touch scrolling work as usual. Hidden while a sheet or dialog holds the page still.
 * While the page is taller than the window it marks <html data-page-scrolls>, which widens the
 * right page padding (gutter-x) so content stays clear of the rail; a sheet keeps that as is,
 * so the page behind it never shifts.
 */
export function PageScrollbar() {
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; startScroll: number; perPixel: number } | null>(null);
  const [shown, setShown] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewport = window.innerHeight;
      const content = root.scrollHeight;
      const overflowing = content - viewport > 1;
      root.toggleAttribute('data-page-scrolls', overflowing);
      const scrollable = overflowing && !root.hasAttribute('data-scroll-locked');
      setShown(scrollable);
      if (!scrollable || !rail.current || !thumb.current) return;
      const railHeight = rail.current.clientHeight;
      const thumbHeight = Math.min(railHeight, Math.max(MIN_THUMB, Math.round((railHeight * viewport) / content)));
      const progress = Math.min(1, Math.max(0, window.scrollY / (content - viewport)));
      thumb.current.style.height = `${thumbHeight}px`;
      thumb.current.style.transform = `translateY(${Math.round(progress * (railHeight - thumbHeight))}px)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Content growing or shrinking (a list loading, a section opening) and sheets opening.
    const resized = new ResizeObserver(schedule);
    resized.observe(document.body);
    const locked = new MutationObserver(schedule);
    locked.observe(root, { attributes: true, attributeFilter: ['data-scroll-locked'] });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      resized.disconnect();
      locked.disconnect();
      root.removeAttribute('data-page-scrolls');
    };
  }, []);

  const scrollTo = (top: number) => window.scrollTo({ top, behavior: 'instant' });

  const onThumbDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rail.current || !thumb.current) return;
    event.preventDefault();
    event.stopPropagation();
    thumb.current.setPointerCapture(event.pointerId);
    const travel = rail.current.clientHeight - thumb.current.offsetHeight;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startScroll: window.scrollY, perPixel: scrollable / Math.max(1, travel) };
    setDragging(true);
  };
  const onThumbMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    scrollTo(current.startScroll + (event.clientY - current.startY) * current.perPixel);
  };
  const onThumbUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  // A tap on the rail brings the thumb's middle there.
  const onRailDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rail.current || !thumb.current) return;
    const box = rail.current.getBoundingClientRect();
    const thumbHeight = thumb.current.offsetHeight;
    const progress = (event.clientY - box.top - thumbHeight / 2) / Math.max(1, box.height - thumbHeight);
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.min(1, Math.max(0, progress)) * scrollable, behavior: 'smooth' });
  };

  return (
    // Decorative for assistive tech: the page scrolls with keys and gestures as always.
    // The strip itself lets taps through; only the rail and thumb take them.
    <div
      aria-hidden="true"
      className={cx(
        'pointer-events-none fixed bottom-[calc(var(--safe-bottom)+0.5rem)] right-0 top-[calc(var(--safe-top)+0.5rem)] z-[45] flex w-4 justify-center transition-opacity duration-200 print:hidden',
        shown ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div
        ref={rail}
        onPointerDown={onRailDown}
        className={cx(
          'relative h-full w-1.5 cursor-pointer rounded-pill bg-ink-100/90 transition-[width] duration-150 hover:w-2.5',
          shown ? 'pointer-events-auto' : 'pointer-events-none',
          dragging && 'w-2.5',
        )}
      >
        <div
          ref={thumb}
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
          onPointerCancel={onThumbUp}
          className={cx(
            'absolute inset-x-0 top-0 touch-none rounded-pill transition-colors duration-150 will-change-transform',
            // A wider invisible grip for fingers.
            "before:absolute before:-inset-x-2.5 before:inset-y-0 before:content-['']",
            dragging ? 'bg-ink-500' : 'bg-ink-300 hover:bg-ink-400',
          )}
        />
      </div>
    </div>
  );
}
