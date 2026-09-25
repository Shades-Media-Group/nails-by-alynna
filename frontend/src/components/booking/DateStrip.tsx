import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { dayParts } from '@/lib/format';
import { centerInStrip } from '@/lib/scroll';

interface DateStripProps {
  days: Array<{ date: string; slots: number }>;
  selected: string | null;
  onSelect: (date: string) => void;
  today: string;
}

/** Horizontal day picker; days without free times are shown but disabled. */
export function DateStrip({ days, selected, onSelect, today }: DateStripProps) {
  const { t } = useTranslation(['booking', 'common']);
  const { locale } = useLocale();
  const strip = useRef<HTMLDivElement>(null);

  // Bring the chosen day into view by moving the strip only, never the page.
  const firstRun = useRef(true);
  useEffect(() => {
    const row = strip.current;
    const day = selected ? row?.querySelector<HTMLElement>(`[data-date="${selected}"]`) : null;
    if (row && day) centerInStrip(row, day, firstRun.current ? 'auto' : 'smooth');
    firstRun.current = false;
  }, [selected]);

  return (
    <div
      ref={strip}
      role="listbox"
      aria-label={t('flow.chooseTime')}
      className="no-scrollbar -mx-[var(--gutter)] flex snap-x gap-2 overflow-x-auto overscroll-x-contain scroll-px-[var(--gutter)] px-[var(--gutter)] pb-2 pt-1"
    >
      {days.map((day) => {
        const parts = dayParts(day.date, locale);
        const isSelected = day.date === selected;
        const available = day.slots > 0;
        return (
          <button
            key={day.date}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-disabled={!available}
            data-date={day.date}
            disabled={!available}
            onClick={() => onSelect(day.date)}
            aria-label={`${parts.weekday} ${parts.day} ${parts.month}${available ? `, ${t('flow.slotCount', { count: day.slots })}` : ''}`}
            className={cx(
              'press flex w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-xl py-3 transition-colors duration-200',
              isSelected
                ? 'bg-ink-900 text-white shadow-[0_10px_24px_-12px_rgb(37_39_38/0.8)]'
                : available
                  ? 'bg-ink-50 text-ink-900 hover:bg-ink-100'
                  : 'cursor-not-allowed bg-transparent text-ink-400',
            )}
          >
            <span className={cx('text-xs font-semibold capitalize', isSelected ? 'text-rose-200' : 'text-ink-600')}>
              {day.date === today ? t('common:time.today') : parts.weekday}
            </span>
            <span className="tabular mt-1 text-xl font-extrabold leading-none">{parts.day}</span>
            <span className="mt-1 text-[0.6875rem] capitalize opacity-70">{parts.month}</span>
            <span
              aria-hidden="true"
              className={cx('mt-2 size-1.5 rounded-pill', available ? (isSelected ? 'bg-rose-400' : 'bg-mint-500') : 'bg-transparent')}
            />
          </button>
        );
      })}
    </div>
  );
}
