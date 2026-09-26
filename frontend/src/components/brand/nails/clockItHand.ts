import rest from '@/assets/clock-it/hand.webp';
import mid from '@/assets/clock-it/hand-mid.webp';
import open from '@/assets/clock-it/hand-open.webp';

/**
 * The hand under the "clock it" nails, in the three frames of the tap: the thumb resting with its
 * nail on the index nail, halfway down, and down (Noto Emoji, Apache 2.0: see
 * src/assets/clock-it/NOTICE.md).
 */
export const CLOCK_IT_HAND = { rest, mid, open };

/** Fetches and decodes the frames ahead of time, so the hand appears and taps without a gap. */
export function preloadClockItHand(): void {
  for (const src of Object.values(CLOCK_IT_HAND)) {
    const image = new Image();
    image.src = src;
    image.decode?.().catch(() => {});
  }
}
