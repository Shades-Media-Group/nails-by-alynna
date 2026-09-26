import hand from '@/assets/clock-it/hand.webp';

/** The hand under the "clock it" nails (Noto Emoji, Apache 2.0: see src/assets/clock-it/NOTICE.md). */
export const CLOCK_IT_HAND = hand;

/** Fetches and decodes the hand ahead of time, so it appears together with its nails. */
export function preloadClockItHand(): void {
  const image = new Image();
  image.src = hand;
  image.decode?.().catch(() => {});
}
