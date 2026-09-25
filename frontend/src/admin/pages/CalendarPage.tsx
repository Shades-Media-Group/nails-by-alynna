import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { Avatar, Button, ButtonLink, Chip, EmptyState, IconButton, SegmentedControl, Skeleton, toast } from '@/components/ui';
import { AddIcon, ChevronLeftIcon, ChevronRightIcon, EventBusyIcon, EventIcon, StorefrontIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { addDays, dateToInstant, formatDayLong, formatTime, relativeDayLabel, zonedDate } from '@/lib/format';
import { SWATCH } from '@/lib/swatch';
import { adminQueries, type AdminStaff, type TimeOff } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { AppointmentRow } from '../components/AppointmentRow';
import { DayStrip } from '../components/DayStrip';
import { useStatusChange, useStudioToday } from '../components/hooks';
import { Timeline } from '../components/Timeline';
import { isDate, isoWeekday, zonedTimeToUtc } from '../components/time';

type View = 'agenda' | 'masters';

/**
 * The studio's day, one day at a time: a strip of three weeks with each day's number of
 * bookings, then the day as a time-ordered agenda or split by master. Date, master and view
 * live in the URL, so a refresh or a shared link opens the same day.
 */
export default function CalendarPage() {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { lp, locale } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { today, now, timeZone } = useStudioToday();
  const setStatus = useStatusChange();

  const raw = params.get('date');
  const date = isDate(raw) ? raw : today;
  const view: View = params.get('view') === 'masters' ? 'masters' : 'agenda';
  const masterParam = params.get('master');

  // Three weeks around the chosen day, fetched once and reused while moving inside them.
  const weekStart = addDays(date, 1 - isoWeekday(date));
  const from = addDays(weekStart, -7);
  const to = addDays(weekStart, 13);
  const appointments = useQuery({ ...adminQueries.appointments({ from, to }), placeholderData: keepPreviousData });
  const timeOff = useQuery({ ...adminQueries.timeOff({ from, to }), placeholderData: keepPreviousData });
  const staff = useQuery(adminQueries.staff());

  const masters = (staff.data ?? []).filter((s) => s.isActive);
  const multiMaster = masters.length > 1;
  const master = multiMaster && masterParam && masters.some((m) => m.id === masterParam) ? masterParam : null;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const search = next.toString();
    navigate({ pathname, search: search ? `?${search}` : '' }, { replace: true, preventScrollReset: true });
  };
  const goTo = (next: string) => update({ date: next });

  const all = appointments.data ?? [];
  const visible = master ? all.filter((a) => a.staff?.id === master) : all;
  const counts = new Map<string, number>();
  for (const a of visible) {
    if (a.status === 'cancelled') continue;
    const day = zonedDate(new Date(a.start), timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const strip = Array.from({ length: 21 }, (_, i) => {
    const day = addDays(from, i);
    return { date: day, count: counts.get(day) ?? 0 };
  });

  const ofDay = visible.filter((a) => zonedDate(new Date(a.start), timeZone) === date);
  const active = ofDay.filter((a) => a.status !== 'cancelled');
  const cancelled = ofDay.filter((a) => a.status === 'cancelled');

  const dayStart = zonedTimeToUtc(date, '00:00', timeZone).getTime();
  const dayEnd = zonedTimeToUtc(addDays(date, 1), '00:00', timeZone).getTime();
  const offToday = (timeOff.data ?? []).filter(
    (o) => new Date(o.start).getTime() < dayEnd && new Date(o.end).getTime() > dayStart && (!master || o.staffId === null || o.staffId === master),
  );

  const relative = relativeDayLabel(t, date, today);
  // A new three-week window shows the previous one's data meanwhile: skeleton, not a false "empty".
  const loading = appointments.isPending || appointments.isPlaceholderData;
  const newBooking = `${lp('/admin/appointments/new')}${date >= today ? `?date=${date}` : ''}`;
  const onComplete = (a: { id: string }) =>
    setStatus.mutate({ id: a.id, status: 'completed' }, { onError: (error) => toast.error(errorMessage(t, error)) });
  const completing = setStatus.isPending && setStatus.variables?.status === 'completed' ? setStatus.variables.id : null;

  return (
    <div className="pb-8">
      <AdminHeader
        title={t('calendar.title')}
        subtitle={
          <span className="block first-letter:uppercase">
            {relative ? `${relative}, ` : ''}
            {formatDayLong(dateToInstant(date), locale, 'UTC')}
          </span>
        }
        actions={
          <>
            {date !== today ? (
              <Button size="sm" variant="outline" onClick={() => goTo(today)}>
                {t('common:time.today')}
              </Button>
            ) : null}
            <ButtonLink to={newBooking} size="sm" icon={AddIcon}>
              {t('nav.newBooking')}
            </ButtonLink>
          </>
        }
      />

      <div className="gutter-x mt-5 flex flex-col gap-5 lg:px-0">
        <div className="flex items-center gap-2">
          <IconButton icon={ChevronLeftIcon} label={t('calendar.previousDay')} variant="outline" onClick={() => goTo(addDays(date, -1))} />
          <label className="min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">{t('calendar.goToDate')}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => (isDate(e.target.value) ? goTo(e.target.value) : undefined)}
              className="tabular h-11 w-full min-w-0 rounded-pill border border-ink-200 bg-white px-4 text-center text-[0.9375rem] font-semibold text-ink-900 outline-none transition-[box-shadow,border-color] duration-150 hover:border-ink-300 focus:border-ink-900 focus:shadow-[0_0_0_4px_var(--color-blush-100)] sm:w-auto"
            />
          </label>
          <IconButton icon={ChevronRightIcon} label={t('calendar.nextDay')} variant="outline" onClick={() => goTo(addDays(date, 1))} />
        </div>

        <DayStrip
          days={strip}
          selected={date}
          onSelect={goTo}
          today={today}
          label={t('calendar.days')}
          describe={(count) => t('calendar.bookingCount', { count })}
        />

        {multiMaster ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl
              label={t('calendar.view')}
              value={view}
              onChange={(next) => update({ view: next === 'agenda' ? null : next, master: null })}
              options={[
                { value: 'agenda', label: t('calendar.agenda') },
                { value: 'masters', label: t('calendar.byMaster') },
              ]}
              className="w-full sm:w-auto"
            />
            {view === 'agenda' ? (
              <div role="group" aria-label={t('calendar.filter')} className="no-scrollbar -mx-[var(--gutter)] flex gap-2 overflow-x-auto px-[var(--gutter)] sm:mx-0 sm:px-0">
                <Chip selected={!master} onClick={() => update({ master: null })}>
                  {t('calendar.allMasters')}
                </Chip>
                {masters.map((m) => (
                  <Chip key={m.id} selected={master === m.id} onClick={() => update({ master: m.id })}>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className={cx('size-2 rounded-pill bg-current', master === m.id ? 'text-white' : SWATCH[m.color].accent)} />
                      {m.name}
                    </span>
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {appointments.isError ? (
          <Alert>{errorMessage(t, appointments.error)}</Alert>
        ) : loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} rounded="xl" className="h-20" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {offToday.length > 0 ? <TimeOffNotes entries={offToday} masters={masters} dayStart={dayStart} dayEnd={dayEnd} /> : null}

            {view === 'masters' && multiMaster ? (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]">
                {masters.map((m) => {
                  const list = active.filter((a) => a.staff?.id === m.id);
                  return (
                    <section key={m.id} aria-labelledby={`master-${m.id}`} className="flex min-w-0 flex-col gap-2">
                      <header className="flex items-center gap-2.5 px-1">
                        <Avatar name={m.name} color={m.color} size="sm" />
                        <h2 id={`master-${m.id}`} className="min-w-0 flex-1 text-h3 font-extrabold">
                          {m.name}
                        </h2>
                        <span className="tabular text-sm font-semibold text-ink-600">{t('calendar.bookingCount', { count: list.length })}</span>
                      </header>
                      {list.length === 0 ? (
                        <p className="rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">{t('calendar.masterFree')}</p>
                      ) : (
                        <Timeline appointments={list} now={now} showNow={date === today} withMaster={false} completing={completing} onComplete={onComplete} />
                      )}
                    </section>
                  );
                })}
              </div>
            ) : active.length === 0 ? (
              <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
                <EmptyState
                  icon={EventIcon}
                  title={t('calendar.empty')}
                  description={date < today ? t('calendar.emptyPast') : t('calendar.emptyText')}
                  action={
                    date >= today ? (
                      <ButtonLink to={newBooking} size="md" icon={AddIcon}>
                        {t('nav.newBooking')}
                      </ButtonLink>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <Timeline
                appointments={active}
                now={now}
                showNow={date === today}
                withMaster={multiMaster && !master}
                completing={completing}
                onComplete={onComplete}
              />
            )}

            {cancelled.length > 0 ? (
              <details className="group rounded-2xl bg-ink-50 p-1">
                <summary className="press flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-ink-700 hover:bg-ink-100 [&::-webkit-details-marker]:hidden">
                  {t('calendar.cancelled', { count: cancelled.length })}
                  <ChevronRightIcon fontSize="inherit" className="text-lg transition-transform duration-200 group-open:rotate-90" />
                </summary>
                <ul className="mt-1 flex flex-col rounded-xl bg-white p-1">
                  {cancelled.map((a) => (
                    <AppointmentRow key={a.id} appointment={a} withMaster={multiMaster} />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** Closures and masters' time off that touch the day, above its bookings. */
function TimeOffNotes({ entries, masters, dayStart, dayEnd }: { entries: TimeOff[]; masters: AdminStaff[]; dayStart: number; dayEnd: number }) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => {
        const member = masters.find((m) => m.id === entry.staffId);
        const start = Math.max(new Date(entry.start).getTime(), dayStart);
        const end = Math.min(new Date(entry.end).getTime(), dayEnd);
        const whole = start === dayStart && end === dayEnd;
        return (
          <li key={entry.id} className="flex items-start gap-3 rounded-2xl bg-peach-50 p-3 text-peach-800">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-white text-lg">
              {entry.staffId === null ? <StorefrontIcon fontSize="inherit" /> : <EventBusyIcon fontSize="inherit" />}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-semibold">
                {entry.staffId === null ? t('calendar.studioClosed') : t('calendar.masterOff', { name: member?.name ?? t('calendar.formerMaster') })}
              </span>
              <span className="tabular block">
                {whole ? t('calendar.allDay') : `${formatTime(new Date(start), locale, timeZone)}–${formatTime(new Date(end), locale, timeZone)}`}
                {entry.reason ? ` · ${entry.reason}` : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
