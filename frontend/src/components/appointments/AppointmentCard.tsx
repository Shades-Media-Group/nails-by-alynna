import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRightIcon, HourglassIcon, ReplayIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { rebookQuery } from '@/lib/appointment';
import { dayParts, formatTime, zonedDate } from '@/lib/format';
import type { Appointment } from '@/types/api';
import { LoyaltyBadge } from '@/components/loyalty/LoyaltyBits';
import { ServiceLines } from './ServiceLines';

/**
 * One booking in a list: calendar leaf, weekday and time, services, and a status only if it
 * matters. Past visits add "Book again" (same services and master) under the card.
 */
export function AppointmentCard({ appointment, rebook = false }: { appointment: Appointment; rebook?: boolean }) {
  const { t } = useTranslation(['account', 'common']);
  const { lp, locale } = useLocale();
  const { timeZone } = useStudio();
  const date = zonedDate(new Date(appointment.start), timeZone);
  const leaf = dayParts(date, locale);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const inactive = appointment.status === 'cancelled' || appointment.status === 'no_show';

  const card = (
    <Link
      to={lp(`/bookings/${appointment.id}`)}
      className={cx(
        'press group flex items-center gap-3 bg-white p-3 pr-4',
        rebook ? 'rounded-t-2xl hover:bg-ink-50' : 'lift rounded-2xl ring-1 ring-inset ring-ink-100',
      )}
    >
      <span
        className={cx(
          'flex w-13 shrink-0 flex-col items-center rounded-xl pb-1.5 pt-1',
          inactive ? 'bg-ink-50 text-ink-500' : 'bg-blush-100 text-ink-900',
        )}
      >
        <span className={cx('text-xs font-semibold capitalize', inactive ? 'text-ink-500' : 'text-rose-700')}>{leaf.month}</span>
        <span className="tabular text-[1.375rem] font-extrabold leading-none tracking-[-0.03em]">{leaf.day}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block font-bold first-letter:uppercase', inactive && 'text-ink-500 line-through decoration-ink-300')}>
          {weekday}, {formatTime(appointment.start, locale, timeZone)}
        </span>
        <ServiceLines appointment={appointment} max={2} className="text-sm text-ink-600" />
        {!inactive ? <LoyaltyBadge loyalty={appointment.loyalty} className="mt-1.5" /> : null}
        {appointment.status === 'pending' ? (
          <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-peach-800">
            <HourglassIcon fontSize="inherit" />
            {t('bookings.waiting')}
          </span>
        ) : inactive ? (
          <span className="mt-0.5 block text-xs font-semibold text-red-700">{t(`common:status.${appointment.status}`)}</span>
        ) : null}
      </span>
      <ChevronRightIcon
        fontSize="inherit"
        className="shrink-0 text-xl text-ink-400 transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1"
      />
    </Link>
  );
  if (!rebook) return card;
  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
      {card}
      <Link
        to={`${lp('/book')}${rebookQuery(appointment)}`}
        className="flex items-center justify-center gap-1.5 border-t border-ink-100 px-4 py-3 text-sm font-semibold text-rose-700 transition-colors hover:bg-ink-50 active:bg-ink-100"
      >
        <ReplayIcon fontSize="inherit" className="text-base" />
        {t('bookings.bookAgain')}
      </Link>
    </div>
  );
}
