import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { dayParts } from '@/lib/format';
import { centerInStrip } from '@/lib/scroll';

export interface StripDay {
  date: string;
  /** Bookings on the day (calendar) or free times (booking). */
  count: number;
  disabled?: boolean;
}

/**
 * Horizontal day picker in the same shape as the client's booking strip. The calendar shows
 * how many bookings each day holds; the booking picker shows a dot on days with free times.
 */
export function DayStrip({
  days,
  selected,
  onSelect,
  today,
  label,
  describe,
  indicator = 'count',
}: {
  days: StripDay[];
  selected: string | null;
  onSelect: (date: string) => void;
  today: string;
  label: string;
  /** Screen-reader text for a day's number, e.g. "3 bookings". */
  describe: (count: number) => string;
  indicator?: 'count' | 'dot';
}) {
  const { t } = useTranslation('common');
  const { locale } = useLocale();
  const strip = useRef<HTMLDivElement>(null);

  // Keep the chosen day in view by moving the strip only, never the page.
  const firstRun = useRef(true);
  useEffect(() => {
    const row = strip.current;
    const day = selected ? row?.querySelector<HTMLElement>(`[data-date="${selected}"]`) : null;
    if (row && day) centerInStrip(row, day, firstRun.current ? 'auto' : 'smooth');
    firstRun.current = false;
  }, [selected, days.length]);

  return (
    <div
      ref={strip}
      role="listbox"
      aria-label={label}
      className="no-scrollbar -mx-[var(--gutter)] flex snap-x gap-2 overflow-x-auto overscroll-x-contain scroll-px-[var(--gutter)] px-[var(--gutter)] pb-2 pt-1 lg:mx-0 lg:scroll-px-0 lg:px-0"
    >
      {days.map((day) => {
        const parts = dayParts(day.date, locale);
        const isSelected = day.date === selected;
        return (
          <button
            key={day.date}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-disabled={day.disabled || undefined}
            disabled={day.disabled}
            data-date={day.date}
            onClick={() => onSelect(day.date)}
            aria-label={`${parts.weekday} ${parts.day} ${parts.month}, ${describe(day.count)}`}
            className={cx(
              'press flex w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-xl py-3 transition-colors duration-200',
              isSelected
                ? 'bg-ink-900 text-white shadow-[0_10px_24px_-12px_rgb(37_39_38/0.8)]'
                : day.disabled
                  ? 'cursor-not-allowed bg-transparent text-ink-400'
                  : 'bg-ink-50 text-ink-900 hover:bg-ink-100',
            )}
          >
            <span className={cx('text-xs font-semibold capitalize', isSelected ? 'text-rose-200' : day.date === today ? 'text-rose-700' : 'text-ink-600')}>
              {day.date === today ? t('time.today') : parts.weekday}
            </span>
            <span className="tabular mt-1 text-xl font-extrabold leading-none">{parts.day}</span>
            <span className="mt-1 text-[0.6875rem] capitalize opacity-70">{parts.month}</span>
            {indicator === 'dot' ? (
              <span
                aria-hidden="true"
                className={cx('mt-2 size-1.5 rounded-pill', day.count > 0 ? (isSelected ? 'bg-rose-400' : 'bg-mint-500') : 'bg-transparent')}
              />
            ) : (
              <span
                aria-hidden="true"
                className={cx(
                  'tabular mt-1.5 inline-flex h-4 min-w-5 items-center justify-center rounded-pill px-1 text-[0.6875rem] font-bold',
                  day.count === 0 ? 'invisible' : isSelected ? 'bg-white/20 text-white' : 'bg-white text-ink-800',
                )}
              >
                {day.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
