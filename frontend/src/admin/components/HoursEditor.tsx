import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui';
import { AddIcon, CloseIcon, ContentCopyIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import type { TimeInterval, WeeklyHours } from '../api';
import { minutesToTime, timeToMinutes } from './time';
import { dayIssue, weekdayName } from './utils';

const MAX_INTERVALS = 4;

function TimeInput({ value, onChange, label, invalid }: { value: string; onChange: (value: string) => void; label: string; invalid: boolean }) {
  return (
    <input
      type="time"
      step={300}
      required
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        'tabular h-11 w-[6.75rem] rounded-pill border bg-white px-3 text-center text-[0.9375rem] font-semibold text-ink-900 outline-none',
        'transition-[box-shadow,border-color] duration-150',
        invalid
          ? 'border-red-500 focus:shadow-[0_0_0_4px_var(--color-red-100)]'
          : 'border-ink-200 hover:border-ink-300 focus:border-ink-900 focus:shadow-[0_0_0_4px_var(--color-blush-100)]',
      )}
    />
  );
}

/**
 * The working week, Monday to Sunday: each day holds up to four stretches of hours (a lunch
 * break is two stretches); a day without hours is a day off.
 */
export function HoursEditor({ value, onChange }: { value: WeeklyHours; onChange: (next: WeeklyHours) => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const week = Array.from({ length: 7 }, (_, day) => value[day] ?? []);

  const setDay = (day: number, intervals: TimeInterval[]) => onChange(week.map((current, i) => (i === day ? intervals : current)));
  const add = (day: number) => {
    const intervals = week[day]!;
    const last = intervals.at(-1);
    const start = last ? Math.min(timeToMinutes(last.end) + 60, 22 * 60) : 10 * 60;
    const end = last ? Math.min(start + 3 * 60, 23 * 60 + 55) : 19 * 60;
    setDay(day, [...intervals, { start: minutesToTime(start), end: minutesToTime(end) }]);
  };
  const copyMonday = () => onChange(week.map((current, day) => (day >= 1 && day <= 4 ? week[0]!.map((i) => ({ ...i })) : current)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" icon={ContentCopyIcon} disabled={week[0]!.length === 0} onClick={copyMonday}>
          {t('hours.copyMonday')}
        </Button>
      </div>
      <ul className="divide-y divide-ink-100 rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
        {week.map((intervals, day) => {
          const name = weekdayName(day, locale);
          const issue = dayIssue(intervals);
          return (
            <li key={day} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{name}</span>
                <Button size="sm" variant="ghost" icon={AddIcon} disabled={intervals.length >= MAX_INTERVALS} onClick={() => add(day)}>
                  {t('hours.add')}
                </Button>
              </div>
              {intervals.length === 0 ? (
                <p className="text-sm text-ink-500">{t('hours.dayOff')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {intervals.map((interval, index) => {
                    const update = (patch: Partial<TimeInterval>) =>
                      setDay(
                        day,
                        intervals.map((current, i) => (i === index ? { ...current, ...patch } : current)),
                      );
                    return (
                      <li key={index} className="flex items-center gap-2">
                        <TimeInput value={interval.start} onChange={(start) => update({ start })} label={t('hours.from', { day: name })} invalid={Boolean(issue)} />
                        <span aria-hidden="true" className="text-ink-500">
                          –
                        </span>
                        <TimeInput value={interval.end} onChange={(end) => update({ end })} label={t('hours.until', { day: name })} invalid={Boolean(issue)} />
                        <IconButton
                          icon={CloseIcon}
                          label={t('hours.remove', { day: name })}
                          onClick={() => setDay(day, intervals.filter((_, i) => i !== index))}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
              {issue ? (
                <p className="text-sm text-red-600" role="alert">
                  {t(`hours.issues.${issue}`)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
