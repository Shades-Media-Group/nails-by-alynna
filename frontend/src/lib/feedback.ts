import type { FeedbackRating } from '@/types/api';

/** The five stars, lowest first. */
export const RATINGS: readonly FeedbackRating[] = [1, 2, 3, 4, 5];

/** A rating from a link (`?rating=4`, the numbers in the email); anything else is no rating. */
export function ratingFrom(value: string | null | undefined): FeedbackRating | null {
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? (rating as FeedbackRating) : null;
}
