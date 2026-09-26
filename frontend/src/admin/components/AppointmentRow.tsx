import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { dayParts, formatDuration, formatPrice, formatTime, fullName, zonedDate } from '@/lib/format';
import { SWATCH } from '@/lib/swatch';
import { PromoBadge } from '@/components/promo/PromoBits';
import type { StaffAppointmentCore } from '../api';
import { StatusBadge } from './StatusBadge';

type RowAppointment = StaffAppointmentCore & { clientStats?: { visits: number; noShows: number } };

/**
 * One appointment in a staff list: time (or a date leaf for lists that span days), client,
 * services, status and the facts that matter at a glance.
 */
export function AppointmentRow({
  appointment: a,
  withDate,
  withMaster,
  past,
  action,
}: {
  appointment: RowAppointment;
  withDate?: boolean;
  withMaster?: boolean;
  /** Already over: the time recedes. */
  past?: boolean;
  /** A quick action beside the row (it can't live inside the link). */
  action?: ReactNode;
}) {
  const { t } = useTranslation(['admin', 'booking', 'common']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { timeZone, currency } = useStudio();
  const names = a.services.map((s) => pick(s.name));
  const more = names.length - 2;
  const inactive = a.status === 'cancelled' || a.status === 'no_show';
  const leaf = withDate ? dayParts(zonedDate(new Date(a.start), timeZone), locale) : null;
  const noShows = a.clientStats?.noShows ?? 0;
  // Colour-coded by master, as in Fresha's calendar; cancelled and missed visits stay grey.
  const tone = !inactive && a.staff ? SWATCH[a.staff.color] : null;

  return (
    <li className="flex items-center gap-1 pr-1">
      <Link
        to={lp(`/admin/appointments/${a.id}`)}
        className="press group flex min-w-0 flex-1 items-start gap-3 rounded-xl p-3 hover:bg-ink-50 focus-visible:bg-ink-50"
      >
        {leaf ? (
          <span className={cx('flex w-12 shrink-0 flex-col items-center rounded-xl pb-1.5 pt-1', inactive ? 'bg-ink-50 text-ink-500' : [tone?.field ?? 'bg-blush-100', 'text-ink-900'])}>
            <span className={cx('text-xs font-semibold capitalize', inactive ? 'text-ink-500' : (tone?.ink ?? 'text-rose-700'))}>{leaf.month}</span>
            <span className="tabular text-xl font-extrabold leading-none tracking-[-0.03em]">{leaf.day}</span>
          </span>
        ) : (
          <span className={cx('tabular w-14 shrink-0 rounded-lg py-1 text-center', past || !tone ? 'bg-ink-50' : tone.field)}>
            <span className={cx('block text-[0.9375rem] font-bold', past ? 'text-ink-500' : tone?.ink)}>{formatTime(a.start, locale, timeZone)}</span>
            <span className="block text-xs text-ink-500">{formatTime(a.end, locale, timeZone)}</span>
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className={cx('min-w-0 break-words font-semibold', inactive && 'text-ink-500 line-through decoration-ink-300')}>
              {fullName(a.client)}
            </span>
            <StatusBadge status={a.status} className="shrink-0" />
          </span>
          <span className="mt-0.5 block text-sm text-ink-600">
            {names.slice(0, 2).join(', ')}
            {more > 0 ? ` ${t('booking:flow.moreServices', { count: more })}` : ''}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-600">
            {leaf ? (
              <span className="tabular font-semibold text-ink-800">
                {formatTime(a.start, locale, timeZone)}–{formatTime(a.end, locale, timeZone)}
              </span>
            ) : null}
            {withMaster && a.staff ? (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className={cx('size-2 rounded-pill bg-current', SWATCH[a.staff.color].accent)} />
                {a.staff.name}
              </span>
            ) : null}
            <span>{formatDuration(t, a.durationMin)}</span>
            <span className="tabular font-semibold text-ink-800">{formatPrice(t, a.totalPrice, currency, a.priceFrom)}</span>
            <PromoBadge appointment={a} />
            {noShows > 0 ? <span className="font-semibold text-red-700">{t('appointment.noShowCount', { count: noShows })}</span> : null}
          </span>
        </span>
      </Link>
      {action}
    </li>
  );
}
