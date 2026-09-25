const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Scrolls a horizontal strip so `item` sits in its middle. Only the strip moves: unlike
 * scrollIntoView it never scrolls the page, so it can't interrupt a flick in progress on iOS.
 */
export function centerInStrip(strip: HTMLElement, item: HTMLElement, behavior: ScrollBehavior = 'smooth'): void {
  const stripBox = strip.getBoundingClientRect();
  const itemBox = item.getBoundingClientRect();
  const target = strip.scrollLeft + (itemBox.left - stripBox.left) - (stripBox.width - itemBox.width) / 2;
  const max = strip.scrollWidth - strip.clientWidth;
  const left = Math.round(Math.max(0, Math.min(max, target)));
  if (Math.abs(left - strip.scrollLeft) < 1) return;
  strip.scrollTo({ left, behavior: reducedMotion() ? 'auto' : behavior });
}

/** Scrolls the page to `top`, calling `done` once it has settled (scrollend, or a timeout). */
export function scrollPageTo(top: number, done?: () => void): void {
  const target = Math.max(0, Math.round(top));
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener('scrollend', finish);
    window.clearTimeout(timer);
    done?.();
  };
  window.addEventListener('scrollend', finish, { once: true });
  const timer = window.setTimeout(finish, 1000);
  window.scrollTo({ top: target, behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (Math.abs(window.scrollY - target) < 1) finish();
}
