import { useTranslation } from 'react-i18next';
import { AddToCalendar } from '@/components/appointments/AddToCalendar';
import { ClockItArt } from '@/components/brand/nails/ClockItArt';
import { Alert } from '@/components/common/Alert';
import { ServiceLines } from '@/components/appointments/ServiceLines';
import { PushSoftAsk } from '@/components/notifications/PushSoftAsk';
import { PromoBadge, PromoRemovedNote } from '@/components/promo/PromoBits';
import { Button, ButtonLink } from '@/components/ui';
import { CalendarAddIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
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
  demo = false,
}: {
  appointment: Appointment;
  rescheduled: boolean;
  /** The move took the booking's promo code off (it didn't cover the new time). */
  promoRemoved?: RemovedPromo | null;
  /** A demo account's preview: nothing was sent, so there is no booking to open or save. */
  demo?: boolean;
}) {
  const { t } = useTranslation(['booking', 'common']);
  const { lp, locale } = useLocale();
  const { timeZone } = useStudio();
  const pending = appointment.status === 'pending';
  const title = rescheduled
    ? t('flow.doneRescheduledTitle')
    : pending
      ? t('flow.doneRequestTitle')
      : t('flow.doneTitle');

  return (
    <div className="flex flex-col items-center pt-6 text-center">
      {rescheduled ? (
        <SuccessMark pending={pending} />
      ) : (
        // A new booking gets the "clock it" hand sign: fresh nails tapping, noticed, yes!
        <div className="flex flex-col items-center" aria-hidden="true">
          <div
            className={cx(
              'size-36 overflow-hidden rounded-3xl',
              pending ? 'bg-peach-100' : 'bg-mint-100',
            )}
          >
            <ClockItArt className="size-full" />
          </div>
          <span
            className="-mt-3 rounded-pill bg-ink-900 px-3 py-1 text-xs font-bold text-white animate-pop"
            style={{ animationDelay: '1.45s' }}
          >
            clock it
          </span>
        </div>
      )}
      <h1 className="mt-5 text-h1 font-extrabold" tabIndex={-1} ref={(el) => el?.focus()}>
        {title}
      </h1>
      <p className="mt-2 max-w-sm text-ink-600">
        {pending
          ? t('flow.doneRequestText', { who: appointment.staff?.name ?? t('flow.theStudio') })
          : t('flow.doneText')}
      </p>
      {demo ? (
        <Alert tone="info" className="mt-4 w-full max-w-sm text-left">
          {t('flow.demoDone')}
        </Alert>
      ) : null}

      <div className="mt-6 w-full max-w-sm rounded-2xl bg-ink-50 p-4 text-left animate-rise">
        <p className="font-bold first-letter:uppercase">
          {formatDateTime(appointment.start, locale, timeZone)}
        </p>
        <ServiceLines appointment={appointment} className="mt-0.5 text-sm text-ink-600" />
        <PromoBadge appointment={appointment} className="mt-2" />
        <p className="mt-3 text-xs text-ink-500">
          {t('flow.code')}:{' '}
          <span className="tabular font-semibold tracking-wide text-ink-800">
            {appointment.code}
          </span>
        </p>
      </div>
      {promoRemoved ? (
        <PromoRemovedNote removed={promoRemoved} className="mt-3 w-full max-w-sm text-left" />
      ) : null}

      <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
        {demo ? null : (
          <>
            <AddToCalendar appointment={appointment}>
              {(open) => (
                <Button variant="primary" icon={CalendarAddIcon} fullWidth onClick={open}>
                  {t('flow.addToCalendar')}
                </Button>
              )}
            </AddToCalendar>
            <ButtonLink
              to={lp(`/bookings/${appointment.id}`)}
              replace
              variant="soft"
              size="md"
              fullWidth
            >
              {t('flow.viewBooking')}
            </ButtonLink>
          </>
        )}
        <ButtonLink to={lp('/home')} replace variant="ghost" size="md" fullWidth>
          {t('flow.backHome')}
        </ButtonLink>
      </div>
      {/* Hear back without keeping the app open: asked here, where it clearly matters. */}
      {demo ? null : (
        <PushSoftAsk placement="booking" booked={!pending} className="mt-6 w-full max-w-sm" />
      )}
    </div>
  );
}
