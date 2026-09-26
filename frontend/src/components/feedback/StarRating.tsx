import { useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { StarIcon, StarOutlineIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { RATINGS } from '@/lib/feedback';
import type { FeedbackRating } from '@/types/api';

const clamp = (value: number) => Math.min(5, Math.max(1, value)) as FeedbackRating;

/**
 * Five stars to choose a rating, like "Tap to Rate" in the App Store: outline stars in the brand
 * pink, filled up to the chosen one, with its word under them. For assistive tech it is a radio
 * group ("4 stars, 4 of 5"): one tab stop, the arrow keys move and choose (stopping at 1 and 5),
 * Home and End jump to the ends.
 */
export function StarRating({
  value,
  onChange,
  labelledBy,
  error,
  className,
}: {
  value: FeedbackRating | null;
  onChange: (value: FeedbackRating) => void;
  /** Id of the visible label of the group. */
  labelledBy: string;
  /** Shown under the stars in place of the rating's word, and read with the group. */
  error?: string;
  className?: string;
}) {
  const { t } = useTranslation('feedback');
  const errorId = useId();
  const stars = useRef<Array<HTMLButtonElement | null>>([]);

  const choose = (rating: FeedbackRating) => {
    onChange(rating);
    stars.current[rating - 1]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, rating: FeedbackRating) => {
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? clamp(rating + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? clamp(rating - 1)
          : event.key === 'Home'
            ? 1
            : event.key === 'End'
              ? 5
              : null;
    if (next === null) return;
    event.preventDefault();
    choose(next);
  };

  // The chosen star is the group's one tab stop (the first until something is chosen).
  const tabStop = value ?? 1;

  return (
    <div className={className}>
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className="-ml-2 flex"
      >
        {RATINGS.map((rating) => {
          const Icon = value !== null && rating <= value ? StarIcon : StarOutlineIcon;
          return (
            <button
              key={rating}
              ref={(el) => {
                stars.current[rating - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === rating}
              aria-label={t('stars', { count: rating })}
              tabIndex={rating === tabStop ? 0 : -1}
              onClick={() => choose(rating)}
              onKeyDown={(event) => onKeyDown(event, rating)}
              className="press inline-flex size-12 items-center justify-center rounded-pill text-[2.25rem] text-rose-500 hover:bg-blush-100"
            >
              <Icon fontSize="inherit" />
            </button>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className="min-h-5 text-sm text-red-600">
          {error}
        </p>
      ) : (
        // The word for sighted users (its line kept, so nothing moves); screen readers hear the chosen star.
        <p aria-hidden="true" className="min-h-5 text-sm font-semibold text-rose-700">
          {value !== null ? t(`scale.${value}`) : null}
        </p>
      )}
    </div>
  );
}

/** A given rating as five small stars, read as "4 stars" (the average's stars are `decorative`). */
export function Stars({
  value,
  decorative = false,
  className,
}: {
  value: number;
  decorative?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('feedback');
  const filled = Math.round(value);
  return (
    <span
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': t('stars', { count: filled }) })}
      className={cx('inline-flex text-rose-500', className)}
    >
      {RATINGS.map((rating) =>
        rating <= filled ? (
          <StarIcon key={rating} fontSize="inherit" />
        ) : (
          <StarOutlineIcon key={rating} fontSize="inherit" />
        ),
      )}
    </span>
  );
}
