import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { EmptyState, Skeleton } from '@/components/ui';
import { EventBusyIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { formatDayLong, zonedDate } from '@/lib/format';
import { availabilityApi } from '@/services/api/endpoints';
import type { Slot } from '@/types/api';
import { DateStrip } from './DateStrip';
import { TimeSlots } from './TimeSlots';

const WINDOW_DAYS = 45;

interface TimeStepProps {
  serviceIds: string[];
  staffId: string | null;
  date: string | null;
  onDate: (date: string) => void;
  slot: Slot | null;
  onSlot: (slot: Slot) => void;
  /** Moving a booking: its own time counts as free. */
  exclude?: string | null;
}

/** Days with their number of free times, then the free times of the chosen day. */
export function TimeStep({ serviceIds, staffId, date, onDate, slot, onSlot, exclude = null }: TimeStepProps) {
  const { t } = useTranslation(['booking', 'common']);
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const today = zonedDate(new Date(), timeZone);

  const days = useQuery({
    queryKey: ['availability-days', serviceIds, staffId, exclude],
    queryFn: () => availabilityApi.days({ serviceIds, staffId, days: WINDOW_DAYS, exclude }),
    enabled: serviceIds.length > 0,
    staleTime: 30_000,
  });
  const firstFree = days.data?.days.find((d) => d.slots > 0)?.date ?? null;

  // Open on the first day that has room, so the first screen already offers times.
  useEffect(() => {
    if (!date && firstFree) onDate(firstFree);
  }, [date, firstFree, onDate]);

  const slots = useQuery({
    queryKey: ['availability-slots', serviceIds, staffId, date, exclude],
    queryFn: () => availabilityApi.slots({ serviceIds, staffId, date: date!, exclude }),
    enabled: Boolean(date) && serviceIds.length > 0,
    staleTime: 15_000,
  });

  if (days.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} rounded="xl" className="h-20 w-16 shrink-0" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} rounded="pill" className="h-11" />
          ))}
        </div>
      </div>
    );
  }
  if (days.isError) return <Alert>{errorMessage(t, days.error)}</Alert>;
  if (!firstFree) {
    return <EmptyState icon={EventBusyIcon} tone="peach" title={t('flow.noSlotsAtAll')} />;
  }

  const selectedDay = days.data.days.find((d) => d.date === date);

  return (
    <div className="flex flex-col gap-5">
      <DateStrip days={days.data.days} selected={date} onSelect={onDate} today={today} />
      <div aria-live="polite">
        {slots.isPending ? (
          <div className="grid grid-cols-4 gap-2" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} rounded="pill" className="h-11" />
            ))}
          </div>
        ) : slots.isError ? (
          <Alert>{errorMessage(t, slots.error)}</Alert>
        ) : slots.data.slots.length === 0 || selectedDay?.slots === 0 ? (
          <div className="rounded-xl bg-ink-50 p-4 text-sm text-ink-700">
            <p className="font-semibold">{t('flow.noSlots')}</p>
            {firstFree && firstFree !== date ? (
              <button type="button" onClick={() => onDate(firstFree)} className="mt-1 font-semibold text-rose-700 underline underline-offset-4">
                {t('flow.nextAvailable', { date: formatDayLong(`${firstFree}T12:00:00Z`, locale, 'UTC') })}
              </button>
            ) : null}
          </div>
        ) : (
          <TimeSlots slots={slots.data.slots} selected={slot?.start ?? null} onSelect={onSlot} />
        )}
      </div>
    </div>
  );
}
