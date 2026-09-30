import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SectionHeading } from '@/components/layout/PageHeader';
import { ChevronRightIcon, HistoryIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { serviceNames } from '@/lib/appointment';
import { dayParts, formatPrice, formatTime, monthYearSince, zonedDate } from '@/lib/format';
import { queries } from '@/services/queries';

/** Visits shown on Home; the rest are one tap away in My bookings. */
const PREVIEW = 3;

/**
 * Home: the client's last visits, with how many there have been and since when; before the first
 * one, a line saying they will be here. A visit counts once it took place: marked done, or
 * confirmed and over (the past list holds a confirmed visit only once its time is over).
 */
export function VisitHistory({ className, style }: { className?: string; style?: CSSProperties }) {
  const { t } = useTranslation(['booking', 'common']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { timeZone, currency } = useStudio();
  const past = useQuery(queries.appointments('past'));
  const summary = useQuery(queries.visitSummary());

  // Nothing until both answer, so the block doesn't appear empty and then fill.
  if (!past.data || !summary.data) return null;
  const visits = past.data.filter((a) => a.status === 'completed' || a.status === 'confirmed').slice(0, PREVIEW);
  const { visits: count, firstVisitAt } = summary.data;
  const thisYear = zonedDate(new Date(), timeZone).slice(0, 4);

  if (visits.length === 0) {
    return (
      <section aria-labelledby="history-title" className={className} style={style}>
        <SectionHeading id="history-title" title={t('home.history.title')} />
        <p className="flex items-center gap-3 rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-white text-xl text-ink-500">
            <HistoryIcon fontSize="inherit" />
          </span>
          {t('home.history.empty')}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="history-title" className={className} style={style}>
      <SectionHeading
        id="history-title"
        title={t('home.history.title')}
        className="mb-1"
        action={
          <Link
            to={`${lp('/bookings')}?tab=past`}
            className="group inline-flex items-center gap-0.5 rounded-pill text-sm font-semibold text-ink-700 hover:text-ink-900"
          >
            {t('home.history.all')}
            <ChevronRightIcon fontSize="inherit" className="shrink-0 text-lg transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1" />
          </Link>
        }
      />
      {firstVisitAt ? (
        <p className="mb-3 text-sm text-ink-600">
          {t('home.history.stats', { count, since: monthYearSince(firstVisitAt, locale, timeZone) })}
        </p>
      ) : null}
      <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
        {visits.map((visit) => {
          const date = zonedDate(new Date(visit.start), timeZone);
          const leaf = dayParts(date, locale);
          const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
          const year = date.slice(0, 4);
          return (
            <li key={visit.id}>
              <Link
                to={lp(`/bookings/${visit.id}`)}
                className="press group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-ink-50"
              >
                <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-blush-100 pb-1 pt-0.5">
                  <span className="text-[0.6875rem] font-semibold capitalize text-rose-700">{leaf.month}</span>
                  <span className="tabular text-lg font-extrabold leading-none tracking-[-0.03em]">{leaf.day}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-semibold first-letter:uppercase">
                    {weekday}, {formatTime(visit.start, locale, timeZone)}
                    {year !== thisYear ? <span className="font-normal text-ink-500"> · {year}</span> : null}
                  </span>
                  <span className="block truncate text-sm text-ink-600">{serviceNames(visit, pick)}</span>
                </span>
                <span className="tabular shrink-0 text-sm font-bold text-rose-700">{formatPrice(t, visit.totalPrice, currency, visit.priceFrom)}</span>
                <ChevronRightIcon
                  fontSize="inherit"
                  className="-ml-1 shrink-0 text-lg text-ink-300 transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
