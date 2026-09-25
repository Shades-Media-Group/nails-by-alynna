import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CalendarAddIcon, ChevronRightIcon, DirectionsIcon, ScheduleIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { calendarEventFor, serviceNames } from '@/lib/appointment';
import { cx } from '@/lib/cx';
import { formatDayLong, formatDuration, formatTime, relativeDayLabel, zonedDate } from '@/lib/format';
import { downloadIcs } from '@/lib/ics';
import type { Appointment } from '@/types/api';
import { StatusBadge } from './StatusBadge';

/** The home screen's lead card: ink field, big time, one-tap calendar and directions. */
export function NextVisitCard({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation(['booking', 'common']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { timeZone, data: config } = useStudio();
  const today = zonedDate(new Date(), timeZone);
  const day = zonedDate(new Date(appointment.start), timeZone);
  const dayLabel = relativeDayLabel(t, day, today) ?? formatDayLong(appointment.start, locale, timeZone);
  const address = [config?.studio.address, config?.studio.city].filter(Boolean).join(', ');

  const action = 'press inline-flex h-10 items-center gap-2 rounded-pill bg-white/12 px-4 text-sm font-semibold text-white hover:bg-white/20';

  return (
    <section aria-label={t('home.nextVisit')} className="overflow-hidden rounded-2xl bg-ink-900 text-white shadow-raised">
      <Link to={lp(`/bookings/${appointment.id}`)} className="block p-5 pb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="caps text-white/60">{t('home.nextVisit')}</p>
          <StatusBadge status={appointment.status} />
        </div>
        <p className="mt-4 text-sm font-semibold capitalize text-rose-200">{dayLabel}</p>
        <p className="tabular text-[3.25rem] font-extrabold leading-none tracking-[-0.04em]">
          {formatTime(appointment.start, locale, timeZone)}
        </p>
        <p className="mt-3 line-clamp-2 text-[0.9375rem] text-white/85">{serviceNames(appointment, pick)}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
          <ScheduleIcon fontSize="inherit" />
          {formatDuration(t, appointment.durationMin)}
          {appointment.staff ? ` · ${appointment.staff.name}` : ''}
          <ChevronRightIcon fontSize="inherit" className="ml-auto text-xl text-white/50" />
        </p>
        {appointment.status === 'pending' ? <p className="mt-3 text-sm text-peach-200">{t('home.pending')}</p> : null}
      </Link>
      <div className="flex flex-wrap gap-2 border-t border-white/10 px-5 py-4">
        <button
          type="button"
          className={action}
          onClick={() => downloadIcs(calendarEventFor(appointment, { t, locale, pick, address }), `nails-by-alynna-${appointment.code}.ics`)}
        >
          <CalendarAddIcon fontSize="inherit" className="text-lg" />
          {t('flow.addToCalendar')}
        </button>
        {config?.studio.mapsUrl ? (
          <a href={config.studio.mapsUrl} target="_blank" rel="noopener noreferrer" className={cx(action)}>
            <DirectionsIcon fontSize="inherit" className="text-lg" />
            {t('common:contact.directions')}
          </a>
        ) : null}
      </div>
    </section>
  );
}
