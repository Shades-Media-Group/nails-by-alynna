import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Spinner } from '@/components/ui';
import { CheckIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { formatTime, fullName } from '@/lib/format';
import type { StaffAppointmentCore } from '../api';
import { AppointmentRow } from './AppointmentRow';

type TimelineAppointment = StaffAppointmentCore & { clientStats?: { visits: number; noShows: number } };

/**
 * A day's appointments in order. On the current day a "now" line sits between what is over
 * and what is coming, and visits that have started get a one-tap "done".
 */
export function Timeline({
  appointments,
  now,
  showNow,
  withMaster,
  completing,
  onComplete,
}: {
  appointments: TimelineAppointment[];
  now: number;
  /** Draw the "now" line (the day shown is today). */
  showNow: boolean;
  withMaster: boolean;
  /** Id of the appointment being marked done, if any. */
  completing?: string | null;
  onComplete?: (appointment: TimelineAppointment) => void;
}) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const nowIndex = appointments.findIndex((a) => new Date(a.start).getTime() > now);
  const marker = (
    <li key="now" className="flex items-center gap-2 px-3 py-1">
      <span className="tabular w-12 text-xs font-bold text-rose-700">
        <span className="sr-only">{t('calendar.now')} </span>
        {formatTime(new Date(now), locale, timeZone)}
      </span>
      <span aria-hidden="true" className="size-2 rounded-pill bg-rose-500" />
      <span aria-hidden="true" className="h-px flex-1 bg-rose-200" />
    </li>
  );

  const rows: ReactNode[] = [];
  appointments.forEach((a, index) => {
    if (showNow && index === nowIndex && index > 0) rows.push(marker);
    const started = new Date(a.start).getTime() <= now;
    const canComplete = Boolean(onComplete) && a.status === 'confirmed' && started;
    rows.push(
      <AppointmentRow
        key={a.id}
        appointment={a}
        withMaster={withMaster}
        past={new Date(a.end).getTime() <= now}
        action={
          canComplete ? (
            completing === a.id ? (
              <span role="status" aria-label={t('common.saving')} className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-ink-50">
                <Spinner className="size-5" />
              </span>
            ) : (
              <IconButton
                icon={CheckIcon}
                label={t('dashboard.markDone', { name: fullName(a.client) })}
                variant="soft"
                disabled={Boolean(completing)}
                onClick={() => onComplete?.(a)}
              />
            )
          ) : undefined
        }
      />,
    );
  });
  if (showNow && nowIndex === -1 && appointments.length > 0) rows.push(marker);

  return <ul className="flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100">{rows}</ul>;
}
