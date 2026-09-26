import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddToCalendarSheet } from '@/components/appointments/AddToCalendar';
import { ServiceLines } from '@/components/appointments/ServiceLines';
import { PromoBadge, PromoRemovedNote } from '@/components/promo/PromoBits';
import { Button, ButtonLink } from '@/components/ui';
import { CalendarAddIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { formatDateTime } from '@/lib/format';
import type { Appointment, RemovedPromo } from '@/types/api';

/** The check draws itself once; everything collapses to instant under reduced motion. */
function SuccessMark({ pending }: { pending: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className="size-20 animate-pop" aria-hidden="true">
      <circle cx="32" cy="32" r="30" className={pending ? 'fill-peach-100' : 'fill-mint-100'} />
      <path
        d={pending ? 'M32 18v16M32 44v1' : 'M20 33l8 8 17-18'}
        pathLength={1}
        strokeDasharray="1"
        className={pending ? 'animate-draw stroke-peach-700' : 'animate-draw stroke-mint-700'}
        style={{ ['--path-length' as string]: 1 }}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function DoneStep({
  appointment,
  rescheduled,
  promoRemoved,
}: {
  appointment: Appointment;
  rescheduled: boolean;
  /** The move took the booking's promo code off (it didn't cover the new time). */
  promoRemoved?: RemovedPromo | null;
}) {
  const { t } = useTranslation(['booking', 'common']);
  const { lp, locale } = useLocale();
  const { timeZone } = useStudio();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const pending = appointment.status === 'pending';
  const title = rescheduled ? t('flow.doneRescheduledTitle') : pending ? t('flow.doneRequestTitle') : t('flow.doneTitle');

  return (
    <div className="flex flex-col items-center pt-6 text-center">
      <SuccessMark pending={pending} />
      <h1 className="mt-5 text-h1 font-extrabold" tabIndex={-1} ref={(el) => el?.focus()}>
        {title}
      </h1>
      <p className="mt-2 max-w-sm text-ink-600">{pending ? t('flow.doneRequestText') : t('flow.doneText')}</p>

      <div className="mt-6 w-full max-w-sm rounded-2xl bg-ink-50 p-4 text-left animate-rise">
        <p className="font-bold first-letter:uppercase">{formatDateTime(appointment.start, locale, timeZone)}</p>
        <ServiceLines appointment={appointment} className="mt-0.5 text-sm text-ink-600" />
        <PromoBadge appointment={appointment} className="mt-2" />
        <p className="mt-3 text-xs text-ink-500">
          {t('flow.code')}: <span className="tabular font-semibold tracking-wide text-ink-800">{appointment.code}</span>
        </p>
      </div>
      {promoRemoved ? <PromoRemovedNote removed={promoRemoved} className="mt-3 w-full max-w-sm text-left" /> : null}

      <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
        <Button
          variant="primary"
          icon={CalendarAddIcon}
          fullWidth
          onClick={() => setCalendarOpen(true)}
        >
          {t('flow.addToCalendar')}
        </Button>
        <ButtonLink to={lp(`/bookings/${appointment.id}`)} replace variant="soft" size="md" fullWidth>
          {t('flow.viewBooking')}
        </ButtonLink>
        <ButtonLink to={lp('/home')} replace variant="ghost" size="md" fullWidth>
          {t('flow.backHome')}
        </ButtonLink>
      </div>
      <AddToCalendarSheet appointment={appointment} open={calendarOpen} onClose={() => setCalendarOpen(false)} />
    </div>
  );
}
