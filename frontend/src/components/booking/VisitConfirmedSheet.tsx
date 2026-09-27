import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/auth';
import { ServiceLines } from '@/components/appointments/ServiceLines';
import { ClockItArt } from '@/components/brand/nails/ClockItArt';
import { Button, ButtonLink, Sheet } from '@/components/ui';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { formatDateTime } from '@/lib/format';
import { SHEET_ORDER, useSheetTurn } from '@/lib/sheetQueue';
import { newlyConfirmed, readSeenVisits, saveSeenVisits } from '@/lib/visitStatus';
import { queries } from '@/services/queries';
import type { Appointment } from '@/types/api';

/**
 * "You're booked!": the studio confirmed a request. Shown once per visit, the next time the
 * client sees their visits after it happened, whether the app was open then (the list refreshes
 * every 30 s and at once on a push) or opened later from the notification: this device remembers
 * how it last saw each visit. The "clock it" hand taps along.
 */
export function VisitConfirmedSheet() {
  const { t } = useTranslation('booking');
  const { lp, locale } = useLocale();
  const { timeZone } = useStudio();
  const { user } = useAuth();
  const client = user?.role === 'client' && !user.isDemo;
  const upcoming = useQuery({ ...queries.appointments('upcoming'), enabled: client });
  // The visit to celebrate, found when a new list arrives (React's "adjust state while
  // rendering": the list this device saved last is read before the effect below replaces it).
  const [seen, setSeen] = useState<{ list: Appointment[] | undefined; visit: Appointment | null }>({
    list: undefined,
    visit: null,
  });
  if (upcoming.data !== seen.list) {
    const fresh =
      client && user && upcoming.data ? newlyConfirmed(upcoming.data, readSeenVisits(user.id)) : [];
    setSeen({ list: upcoming.data, visit: seen.visit ?? fresh[0] ?? null });
  }
  const visit = seen.visit;

  useEffect(() => {
    if (client && user && upcoming.data) saveSeenVisits(user.id, upcoming.data);
  }, [client, user, upcoming.data]);

  const myTurn = useSheetTurn('visit-confirmed', SHEET_ORDER.celebration, visit !== null);
  const close = () => setSeen((current) => ({ ...current, visit: null }));

  return (
    <Sheet open={myTurn} onClose={close} title={t('live.confirmedTitle')} hideTitle>
      {visit ? (
        <div className="flex flex-col items-center pb-1 text-center">
          <div className="size-32 overflow-hidden rounded-3xl bg-mint-100">
            <ClockItArt className="size-full" />
          </div>
          <p className="mt-4 text-h2 font-extrabold" aria-hidden="true">
            {t('live.confirmedTitle')}
          </p>
          <p className="mt-1.5 max-w-sm text-ink-600">
            {t('live.confirmedText', {
              who: visit.staff?.name ?? t('flow.theStudio'),
              when: formatDateTime(visit.start, locale, timeZone),
            })}
          </p>
          <ServiceLines appointment={visit} className="mt-1 text-sm text-ink-500" />
          <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
            <ButtonLink
              to={lp(`/bookings/${visit.id}`)}
              variant="primary"
              fullWidth
              onClick={close}
            >
              {t('live.openVisit')}
            </ButtonLink>
            <Button variant="ghost" size="md" fullWidth onClick={close}>
              {t('live.done')}
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
