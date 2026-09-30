import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { SectionHeading } from '@/components/layout/PageHeader';
import { Button, EmptyState, IconButton, Sheet, Skeleton, toast } from '@/components/ui';
import { AddIcon, CalendarAddIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, ExpandMoreIcon, RemoveIcon } from '@/components/ui/icons';
import { LOCALE_TAGS, type Locale } from '@/i18n/config';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { addDays, dateToInstant, dayParts, formatDateTime, formatDayLong, formatDuration } from '@/lib/format';
import { ApiError } from '@/services/api/client';
import { adminApi, adminQueries, type AdminStaff, type OutsideHoursBooking, type WorkDay } from '../api';
import { ConfirmSheet } from './ConfirmSheet';
import { useStudioToday } from './hooks';
import { DEFAULT_SESSION_MIN, DEFAULT_TIMES, MAX_DAY_BOOKINGS, nextTime, sessionEnd, timesIssue } from './sessions';
import { isTime } from './time';

/** Must match the API (admin/team.ts): how far ahead days open. */
const DAYS_AHEAD = 365;
/** Open days listed before "Show more": the next few, the rest on request. */
const SHOWN_DAYS = 4;

const refreshKeys = [['admin', 'work-days'], ['admin', 'stats'], ['staff'], ['availability-days'], ['availability-slots']];

/**
 * Working-days mode: the days a master opened, from today on, and the sheet to open more. Each
 * row says the hours, how many clients the day takes and how many are booked.
 */
export function WorkDaysPanel({
  staff,
  title,
}: {
  staff: AdminStaff;
  /** Another master's days (Team): their name in the heading. */ title?: string;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const { lp, locale } = useLocale();
  const { today, timeZone } = useStudioToday();
  const queryClient = useQueryClient();
  const sessionMin = staff.sessionMin ?? DEFAULT_SESSION_MIN;
  const days = useQuery(adminQueries.workDays({ from: today, to: addDays(today, DAYS_AHEAD), staffId: staff.id }));
  const [editing, setEditing] = useState<{ day: WorkDay | null } | null>(null);
  const [closing, setClosing] = useState<WorkDay | null>(null);
  const [outside, setOutside] = useState<OutsideHoursBooking[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const close = useMutation({
    mutationFn: (day: WorkDay) => adminApi.deleteWorkDay(day.id),
    onSuccess: ({ outsideHours }) => {
      for (const queryKey of refreshKeys) void queryClient.invalidateQueries({ queryKey });
      setOutside(outsideHours);
      toast.success(t('workDays.closed'));
      setClosing(null);
      setEditing(null);
    },
  });

  const list = days.data ?? [];
  const hidden = showAll ? 0 : Math.max(0, list.length - SHOWN_DAYS);
  const last = [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const openButton = (
    <Button size="sm" icon={AddIcon} onClick={() => setEditing({ day: null })}>
      {t('workDays.open')}
    </Button>
  );

  return (
    <section aria-labelledby={`work-days-${staff.id}`}>
      <SectionHeading id={`work-days-${staff.id}`} title={title ?? t('workDays.title')} action={list.length > 0 ? openButton : undefined} />
      <p className="-mt-1 mb-3 text-sm text-ink-600">{t('workDays.text', { session: formatDuration(t, sessionMin) })}</p>

      {days.isPending ? (
        <Skeleton rounded="xl" className="h-40" />
      ) : days.isError ? (
        <Alert>{errorMessage(t, days.error)}</Alert>
      ) : list.length === 0 ? (
        <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
          <EmptyState
            icon={CalendarAddIcon}
            tone="cyan"
            title={t('workDays.empty')}
            description={t('workDays.emptyText')}
            action={
              <Button size="md" icon={AddIcon} onClick={() => setEditing({ day: null })}>
                {t('workDays.open')}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <ul id={`work-days-list-${staff.id}`} className="flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100">
            {(showAll ? list : list.slice(0, SHOWN_DAYS)).map((day) => (
              <WorkDayRow key={day.id} day={day} today={today} onOpen={() => setEditing({ day })} />
            ))}
          </ul>
          {list.length > SHOWN_DAYS ? (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              aria-expanded={showAll}
              aria-controls={`work-days-list-${staff.id}`}
              onClick={() => setShowAll((all) => !all)}
            >
              {showAll ? t('workDays.showFewer') : t('workDays.showMore', { count: hidden })}
              <ExpandMoreIcon aria-hidden="true" fontSize="inherit" className={cx('text-lg transition-transform duration-200', showAll && 'rotate-180')} />
            </Button>
          ) : null}
        </>
      )}

      {outside && outside.length > 0 ? (
        <Alert tone="warning" className="mt-3">
          <p className="font-semibold">{t('workDays.outside', { count: outside.length })}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {outside.slice(0, 6).map((booking) => (
              <li key={booking.id}>
                <Link to={lp(`/admin/appointments/${booking.id}`)} className="font-semibold underline underline-offset-4">
                  <span className="first-letter:uppercase">{formatDateTime(booking.start, locale, timeZone)}</span> · {booking.clientName}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {editing ? (
        <WorkDaySheet
          staff={staff}
          day={editing.day}
          opened={list}
          defaults={last ? last.times : null}
          onClose={() => setEditing(null)}
          onSaved={setOutside}
          onCloseDay={(day) => setClosing(day)}
        />
      ) : null}
      <ConfirmSheet
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={t('workDays.closeTitle')}
        description={closing && closing.booked > 0 ? t('workDays.closeTextBooked', { count: closing.booked }) : t('workDays.closeText')}
        confirmLabel={t('workDays.close')}
        loading={close.isPending}
        error={close.error}
        onConfirm={() => closing && close.mutate(closing)}
      />
    </section>
  );
}

function WorkDayRow({ day, today, onOpen }: { day: WorkDay; today: string; onOpen: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const parts = dayParts(day.date, locale);
  const takes = day.times.length;
  const full = day.booked >= takes;
  const when = day.date === today ? t('common:time.today') : day.date === addDays(today, 1) ? t('common:time.tomorrow') : null;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('workDays.editNamed', { day: formatDayLong(dateToInstant(day.date), locale, 'UTC') })}
        className="press flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-ink-50"
      >
        <span
          aria-hidden="true"
          className={cx('flex w-14 shrink-0 flex-col items-center rounded-xl py-2', day.date === today ? 'bg-ink-900 text-white' : 'bg-blush-50 text-ink-900')}
        >
          <span className={cx('text-[0.6875rem] font-bold uppercase tracking-wide', day.date === today ? 'text-rose-200' : 'text-rose-700')}>
            {parts.weekday}
          </span>
          <span className="tabular text-xl font-extrabold leading-tight">{parts.day}</span>
          <span className="text-[0.6875rem] font-semibold">{parts.month}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-600">
            {t('workDays.takes', { count: takes })}
            {when ? <span className="ml-2 text-rose-700">{when}</span> : null}
          </span>
          <span className="tabular mt-0.5 block font-semibold">{day.times.join(' · ')}</span>
          <span className="mt-2 flex items-center gap-2">
            <span className="flex gap-1" aria-hidden="true">
              {Array.from({ length: takes }, (_, i) => (
                <span key={i} className={cx('h-1.5 w-4 rounded-pill', i < day.booked ? 'bg-ink-900' : 'bg-ink-100')} />
              ))}
            </span>
            <span className={cx('text-sm font-semibold', full ? 'text-mint-700' : 'text-ink-700')}>
              {full ? t('workDays.full') : t('workDays.booked', { count: day.booked, total: takes })}
            </span>
          </span>
        </span>
        <ChevronRightIcon aria-hidden="true" className="shrink-0 text-xl text-ink-400" fontSize="inherit" />
      </button>
    </li>
  );
}

/**
 * Open days, or change one: the dates (a month grid; a weekday's letter picks every such day of
 * the month), then when each booking of the day starts. − and + take a booking away or add one a
 * session after the last; each time can be changed or removed on its own.
 */
function WorkDaySheet({
  staff,
  day,
  opened,
  defaults,
  onClose,
  onSaved,
  onCloseDay,
}: {
  staff: AdminStaff;
  /** null: open new days. */
  day: WorkDay | null;
  opened: WorkDay[];
  /** The times of the last day opened, as a starting point for new ones. */
  defaults: string[] | null;
  onClose: () => void;
  onSaved: (outside: OutsideHoursBooking[]) => void;
  onCloseDay: (day: WorkDay) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const { today } = useStudioToday();
  const queryClient = useQueryClient();
  const sessionMin = staff.sessionMin ?? DEFAULT_SESSION_MIN;
  const session = formatDuration(t, sessionMin);
  const [dates, setDates] = useState<string[]>(day ? [day.date] : []);
  const [times, setTimes] = useState<string[]>(() => [...(day?.times ?? defaults ?? DEFAULT_TIMES)]);
  const [touched, setTouched] = useState(false);

  const issue = timesIssue(times, sessionMin);
  const noDates = dates.length === 0;
  const add = () => setTimes((current) => [...current, nextTime(current, sessionMin)]);
  const removeAt = (index: number) => setTimes((current) => current.filter((_, i) => i !== index));

  const save = useMutation({
    mutationFn: () => adminApi.saveWorkDays({ staffId: staff.id, dates, times: [...new Set(times)].sort() }),
    onSuccess: ({ outsideHours }) => {
      for (const queryKey of refreshKeys) void queryClient.invalidateQueries({ queryKey });
      onSaved(outsideHours);
      toast.success(day ? t('common.saved') : t('workDays.opened', { count: dates.length }));
      onClose();
    },
  });
  const serverIssue = save.error instanceof ApiError ? Object.values(save.error.fields)[0] : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (issue || noDates) return;
    save.mutate();
  };

  const title = day ? formatDayLong(dateToInstant(day.date), locale, 'UTC') : t('workDays.openTitle');
  const saveLabel = day ? t('common.save') : noDates ? t('workDays.open') : t('workDays.openCount', { count: dates.length });
  const issueText =
    issue?.issue === 'overlap'
      ? t('workDays.issues.overlap', { first: issue.first, second: issue.second, session })
      : issue?.issue === 'too_late'
        ? t('workDays.issues.too_late', { time: issue.time })
        : issue
          ? t('workDays.issues.required')
          : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      description={day ? t('workDays.editHint') : t('workDays.openHint')}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button type="submit" form="work-day-form" size="md" loading={save.isPending} className="min-w-32">
            {saveLabel}
          </Button>
          {day ? (
            <Button size="md" variant="ghost" className="text-red-700" onClick={() => onCloseDay(day)}>
              {t('workDays.close')}
            </Button>
          ) : null}
        </div>
      }
    >
      <form id="work-day-form" className="flex flex-col gap-6 py-2" onSubmit={submit} noValidate>
        {!day ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold text-ink-700">{t('workDays.dates')}</legend>
            <MonthGrid today={today} selected={dates} opened={new Set(opened.map((d) => d.date))} onChange={setDates} />
            <div className="flex min-h-9 items-center justify-between gap-3">
              <p className={cx('text-sm', touched && noDates ? 'font-semibold text-red-600' : 'text-ink-600')} role={touched && noDates ? 'alert' : undefined}>
                {noDates ? t('workDays.pickDates') : t('workDays.picked', { count: dates.length })}
              </p>
              {!noDates ? (
                <Button size="sm" variant="ghost" onClick={() => setDates([])}>
                  {t('workDays.clear')}
                </Button>
              ) : null}
            </div>
          </fieldset>
        ) : day.booked > 0 ? (
          <p className="rounded-xl bg-ink-50 p-3 text-sm text-ink-700">{t('workDays.bookedNote', { count: day.booked })}</p>
        ) : null}

        <fieldset className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <legend id="work-day-bookings" className="text-[0.9375rem] font-semibold">
                {t('workDays.bookings')}
              </legend>
              <p className="text-sm text-ink-600">{t('workDays.bookingsHint', { session })}</p>
            </div>
            <div role="group" aria-labelledby="work-day-bookings" className="flex shrink-0 items-center gap-1 rounded-pill bg-ink-50 p-1">
              <IconButton
                icon={RemoveIcon}
                size="sm"
                variant="outline"
                label={t('workDays.fewer')}
                disabled={times.length <= 1}
                onClick={() => removeAt(times.length - 1)}
              />
              <output aria-live="polite" className="tabular w-8 text-center text-lg font-extrabold">
                {times.length}
              </output>
              <IconButton
                icon={AddIcon}
                size="sm"
                variant="outline"
                label={t('workDays.more')}
                disabled={times.length >= MAX_DAY_BOOKINGS}
                onClick={add}
              />
            </div>
          </div>

          <ol className="flex flex-col gap-2 rounded-2xl bg-ink-50 p-2">
            {times.map((time, index) => {
              const clash = touched && issue !== null && issue.issue !== 'required' && (issue.issue === 'overlap' ? issue.first === time || issue.second === time : issue.time === time);
              return (
                <li key={index} className="flex items-center gap-3 rounded-xl bg-white py-2 pl-3 pr-1 ring-1 ring-inset ring-ink-100">
                  <span aria-hidden="true" className="tabular inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-blush-50 text-sm font-bold text-rose-700">
                    {index + 1}
                  </span>
                  <TimeField
                    label={t('workDays.timeLabel', { n: index + 1 })}
                    value={time}
                    invalid={clash || (touched && !isTime(time))}
                    onChange={(value) => setTimes((current) => current.map((v, i) => (i === index ? value : v)))}
                  />
                  <span className="tabular min-w-0 flex-1 text-sm text-ink-600">
                    {isTime(time) ? t('workDays.until', { time: sessionEnd(time, sessionMin) }) : null}
                  </span>
                  <IconButton
                    icon={CloseIcon}
                    label={t('workDays.removeTime', { time: time || index + 1 })}
                    disabled={times.length <= 1}
                    onClick={() => removeAt(index)}
                  />
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="outline" icon={AddIcon} disabled={times.length >= MAX_DAY_BOOKINGS} onClick={add}>
              {t('workDays.addBooking')}
            </Button>
            <p className="text-sm text-ink-600">{t('workDays.deskNote')}</p>
          </div>
          {touched && issueText ? (
            <p className="text-sm text-red-600" role="alert">
              {issueText}
            </p>
          ) : null}
        </fieldset>

        {save.isError ? (
          <Alert>
            {serverIssue ? t(`workDays.issues.${serverIssue}`, { session, first: '', second: '', time: '', defaultValue: errorMessage(t, save.error) }) : errorMessage(t, save.error)}
          </Alert>
        ) : null}
      </form>
    </Sheet>
  );
}

function TimeField({ label, value, invalid, onChange }: { label: string; value: string; invalid: boolean; onChange: (value: string) => void }) {
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
        'tabular h-11 w-[6.75rem] shrink-0 rounded-pill border bg-white px-3 text-center text-[0.9375rem] font-semibold text-ink-900 outline-none',
        'transition-[box-shadow,border-color] duration-150',
        invalid
          ? 'border-red-500 focus:shadow-[0_0_0_4px_var(--color-red-100)]'
          : 'border-ink-200 hover:border-ink-300 focus:border-ink-900 focus:shadow-[0_0_0_4px_var(--color-blush-100)]',
      )}
    />
  );
}

const monthFormats = new Map<Locale, Intl.DateTimeFormat>();
function monthTitle(month: string, locale: Locale): string {
  let f = monthFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    monthFormats.set(locale, f);
  }
  const text = f.format(dateToInstant(`${month}-01`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function weekdayLetter(index: number, locale: Locale, width: 'narrow' | 'long'): string {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { weekday: width, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 1 + index, 12)),
  );
}

const monthOf = (date: string) => date.slice(0, 7);
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * A month of days, Monday first, to pick several: days before today (and past a year) can't be
 * picked, days already open carry a dot (picking one changes it). A weekday's letter picks, or
 * drops, every such day still ahead in the month.
 */
function MonthGrid({
  today,
  selected,
  opened,
  onChange,
}: {
  today: string;
  selected: string[];
  opened: Set<string>;
  onChange: (dates: string[]) => void;
}) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const first = monthOf(today);
  const lastDate = addDays(today, DAYS_AHEAD);
  const [month, setMonth] = useState(first);
  const chosen = new Set(selected);

  const start = `${month}-01`;
  const offset = (new Date(`${start}T12:00:00Z`).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const days = Array.from({ length }, (_, i) => addDays(start, i));
  const pickable = (date: string) => date >= today && date <= lastDate;

  const toggle = (date: string) => onChange(chosen.has(date) ? selected.filter((d) => d !== date) : [...selected, date].sort());
  const toggleWeekday = (weekday: number) => {
    const matching = days.filter((d, i) => (offset + i) % 7 === weekday && pickable(d));
    if (matching.length === 0) return;
    const all = matching.every((d) => chosen.has(d));
    onChange(all ? selected.filter((d) => !matching.includes(d)) : [...new Set([...selected, ...matching])].sort());
  };

  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-inset ring-ink-100">
      <div className="mb-2 flex items-center justify-between gap-2">
        <IconButton
          icon={ChevronLeftIcon}
          size="sm"
          label={t('workDays.prevMonth')}
          disabled={month <= first}
          onClick={() => setMonth(shiftMonth(month, -1))}
        />
        <p className="text-[0.9375rem] font-extrabold" aria-live="polite">
          {monthTitle(month, locale)}
        </p>
        <IconButton
          icon={ChevronRightIcon}
          size="sm"
          label={t('workDays.nextMonth')}
          disabled={month >= monthOf(lastDate)}
          onClick={() => setMonth(shiftMonth(month, 1))}
        />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, weekday) => (
          <button
            key={`w${weekday}`}
            type="button"
            onClick={() => toggleWeekday(weekday)}
            aria-label={t('workDays.everyWeekday', {
              weekday: weekdayLetter(weekday, locale, 'long'),
              month: monthTitle(month, locale),
            })}
            className="press flex h-8 items-center justify-center rounded-lg text-xs font-bold uppercase text-ink-600 hover:bg-ink-50"
          >
            {weekdayLetter(weekday, locale, 'narrow')}
          </button>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} aria-hidden="true" />
        ))}
        {days.map((date) => {
          const isChosen = chosen.has(date);
          const isOpen = opened.has(date);
          const can = pickable(date);
          const label = formatDayLong(dateToInstant(date), locale, 'UTC');
          return (
            <button
              key={date}
              type="button"
              disabled={!can}
              aria-pressed={isChosen}
              aria-label={isOpen ? t('workDays.alreadyOpen', { day: label }) : label}
              onClick={() => toggle(date)}
              className={cx(
                'press tabular relative flex h-11 flex-col items-center justify-center rounded-xl text-[0.9375rem] font-semibold transition-colors duration-150',
                isChosen
                  ? 'bg-ink-900 text-white'
                  : !can
                    ? 'cursor-not-allowed text-ink-300'
                    : date === today
                      ? 'text-ink-900 ring-1 ring-inset ring-ink-900 hover:bg-ink-50'
                      : 'text-ink-900 hover:bg-ink-50',
              )}
            >
              {Number(date.slice(8))}
              {isOpen ? (
                <span
                  aria-hidden="true"
                  className={cx('absolute bottom-1.5 size-1 rounded-pill', isChosen ? 'bg-rose-200' : 'bg-rose-600')}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {opened.size > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-600">
          <span aria-hidden="true" className="size-1.5 rounded-pill bg-rose-600" />
          {t('workDays.openLegend')}
        </p>
      ) : null}
    </div>
  );
}
