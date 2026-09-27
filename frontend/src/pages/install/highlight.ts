/**
 * The mark on the control to tap, the same on screenshots and drawings: a logo-pink line with a
 * soft blush halo. It pops in once after its step (reduced motion: it is simply there).
 */
export const HIGHLIGHT =
  'ring-[3px] ring-rose-500 outline-4 outline-offset-[3px] outline-rose-200/70 motion-safe:animate-pop';

/** Pops in just after its step card rises (the list staggers by 60 ms per step). */
export const highlightDelay = (step: number) => ({ animationDelay: `${Math.min(step * 60, 420) + 300}ms` });
