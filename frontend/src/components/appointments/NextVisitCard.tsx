import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CalendarAddIcon, ChevronRightIcon, DirectionsIcon, HourglassIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { calendarEventFor } from '@/lib/appointment';
import { dateToInstant, dayParts, formatDuration, formatTime, relativeDayLabel, zonedDate } from '@/lib/format';
import { downloadIcs } from '@/lib/ics';
import type { Locale } from '@/i18n/config';
import type { TFunction } from 'i18next';
import type { Appointment } from '@/types/api';
import { LoyaltyBadge } from '@/components/loyalty/LoyaltyBits';
import { ServiceLines } from './ServiceLines';

const DAY_MS = 86_400_000;

/** "Today" / "Tomorrow" / "Tuesday" this week / "29 September" further out. */
function visitDay(t: TFunction, locale: Locale, date: string, today: string): string {
  const relative = relativeDayLabel(t, date, today);
  if (relative) return relative;
  const instant = dateToInstant(date);
  const soon = instant.getTime() - dateToInstant(today).getTime() < 7 * DAY_MS;
  const label = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    ...(soon ? { weekday: 'long' } : { day: 'numeric', month: 'long' }),
  }).format(instant);
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}

/**
 * The home screen's lead card. The date sits on a calendar leaf, the time reads as a sentence,
 * and a status only appears when it needs attention (a request still waiting for the studio).
 */
export function NextVisitCard({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation(['booking', 'common']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { timeZone, data: config } = useStudio();
  const today = zonedDate(new Date(), timeZone);
  const date = zonedDate(new Date(appointment.start), timeZone);
  const leaf = dayParts(date, locale);
  const address = [config?.studio.address, config?.studio.city].filter(Boolean).join(', ');
  const duration = formatDuration(t, appointment.durationMin);

  const action =
    'press inline-flex h-9 items-center gap-1.5 rounded-pill bg-white/10 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/18';

  return (
    <section aria-label={t('home.nextVisit')} className="rounded-2xl bg-ink-900 text-white shadow-raised">
      <Link to={lp(`/bookings/${appointment.id}`)} className="group flex items-start gap-4 p-4 pb-3">
        <span className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-white pb-2 pt-1.5 text-ink-900">
          <span className="text-xs font-semibold capitalize text-rose-600">{leaf.month}</span>
          <span className="tabular text-[1.625rem] font-extrabold leading-none tracking-[-0.03em]">{leaf.day}</span>
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="block text-[1.0625rem] font-bold leading-snug">
            {t('home.visitAt', { day: visitDay(t, locale, date, today), time: formatTime(appointment.start, locale, timeZone) })}
          </span>
          <ServiceLines appointment={appointment} max={2} className="mt-0.5 text-sm leading-snug text-white/75" />
          <span className="mt-0.5 block text-sm text-white/55">
            {appointment.staff ? t('home.durationWith', { duration, name: appointment.staff.name }) : duration}
          </span>
          <LoyaltyBadge loyalty={appointment.loyalty} className="mt-2" />
        </span>
        <ChevronRightIcon
          fontSize="inherit"
          className="mt-0.5 shrink-0 text-xl text-white/40 transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1"
        />
      </Link>
      {appointment.status === 'pending' ? (
        <p className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-white/8 px-3 py-2 text-sm text-peach-200">
          <HourglassIcon fontSize="inherit" className="shrink-0 text-base" />
          {t('home.pending')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        <button
          type="button"
          className={action}
          onClick={() => downloadIcs(calendarEventFor(appointment, { t, locale, pick, address }), `nails-by-alynna-${appointment.code}.ics`)}
        >
          <CalendarAddIcon fontSize="inherit" className="text-base" />
          {t('flow.addToCalendar')}
        </button>
        {config?.studio.mapsUrl ? (
          <a href={config.studio.mapsUrl} target="_blank" rel="noopener noreferrer" className={action}>
            <DirectionsIcon fontSize="inherit" className="text-base" />
            {t('common:contact.directions')}
          </a>
        ) : null}
      </div>
    </section>
  );
}
