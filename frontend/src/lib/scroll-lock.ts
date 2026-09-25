/**
 * Freezes the page behind sheets and dialogs (see `html[data-scroll-locked]` in index.css).
 * Locks are counted, so the page only scrolls again once the last one is released, and the
 * scroll position itself is never touched: no jump on close, no Safari toolbar flicker.
 */
let locks = 0;

export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const root = document.documentElement;
  if (locks === 0) root.dataset.scrollLocked = '';
  locks++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) delete root.dataset.scrollLocked;
  };
}
