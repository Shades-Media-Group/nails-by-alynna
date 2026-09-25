import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TimeSlots } from '@/components/booking/TimeSlots';
import { Alert } from '@/components/common/Alert';
import { Checkbox, SegmentedControl, Skeleton, TextField } from '@/components/ui';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { dateToInstant, formatDayLong } from '@/lib/format';
import { availabilityApi } from '@/services/api/endpoints';
import { DayStrip } from './DayStrip';
import { useStudioToday } from './hooks';
import { isDate, isTime, zonedParts, zonedTimeToUtc } from './time';

const WINDOW_DAYS = 45;

export interface TimeChoice {
  /** Start instant (ISO). */
  start: string;
  /** Masters free at that time; empty for a typed time. */
  staffIds: string[];
  /** Typed by hand instead of picked from the free times. */
  custom: boolean;
  /** Book even when it overlaps another appointment. */
  force: boolean;
}

type Mode = 'free' | 'custom';

/**
 * When: the free times clients see (days with room, then times), or any time typed by hand
 * for the desk, with an explicit override for overlapping another booking.
 */
export function SlotPicker({
  serviceIds,
  staffId,
  value,
  onChange,
  initialDate,
  exclude = null,
}: {
  serviceIds: string[];
  /** null = any master. */
  staffId: string | null;
  value: TimeChoice | null;
  onChange: (value: TimeChoice | null) => void;
  /** Day to open on (e.g. from the calendar). */
  initialDate?: string;
  /** Moving a booking: its own time counts as free. */
  exclude?: string | null;
}) {
  const { t } = useTranslation(['admin', 'booking', 'common']);
  const { locale } = useLocale();
  const { today, timeZone } = useStudioToday();
  const initial = value ? zonedParts(value.start, timeZone) : null;
  const [mode, setMode] = useState<Mode>(value?.custom ? 'custom' : 'free');
  const [date, setDate] = useState<string | null>(value && !value.custom ? initial!.date : null);
  const [customDate, setCustomDate] = useState(initial?.date ?? initialDate ?? today);
  const [customTime, setCustomTime] = useState(value?.custom ? initial!.time : '');
  const [force, setForce] = useState(value?.force ?? false);
  const ready = serviceIds.length > 0;

  const days = useQuery({
    queryKey: ['availability-days', serviceIds, staffId, exclude],
    queryFn: () => availabilityApi.days({ serviceIds, staffId, days: WINDOW_DAYS, exclude }),
    enabled: ready && mode === 'free',
    staleTime: 30_000,
  });
  const list = days.data?.days ?? [];
  const firstFree = list.find((d) => d.slots > 0)?.date ?? null;
  const preferred = initialDate && list.some((d) => d.date === initialDate && d.slots > 0) ? initialDate : null;
  const activeDate = date ?? preferred ?? firstFree;

  const slots = useQuery({
    queryKey: ['availability-slots', serviceIds, staffId, activeDate, exclude],
    queryFn: () => availabilityApi.slots({ serviceIds, staffId, date: activeDate!, exclude }),
    enabled: ready && mode === 'free' && Boolean(activeDate),
    staleTime: 15_000,
  });

  const emitCustom = (nextDate: string, nextTime: string, nextForce: boolean) => {
    if (isDate(nextDate) && isTime(nextTime)) {
      onChange({ start: zonedTimeToUtc(nextDate, nextTime, timeZone).toISOString(), staffIds: [], custom: true, force: nextForce });
    } else {
      onChange(null);
    }
  };
  const switchMode = (next: Mode, day?: string) => {
    setMode(next);
    if (next === 'custom') {
      const d = day ?? customDate;
      setCustomDate(d);
      emitCustom(d, customTime, force);
    } else {
      onChange(null);
    }
  };

  const modes = (
    <SegmentedControl
      label={t('booking.when')}
      value={mode}
      onChange={(next) => switchMode(next)}
      options={[
        { value: 'free', label: t('booking.freeTimes') },
        { value: 'custom', label: t('booking.customTime') },
      ]}
      className="w-full sm:w-auto"
    />
  );

  if (mode === 'custom') {
    return (
      <div className="flex flex-col gap-4">
        {modes}
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('booking.date')}
            type="date"
            value={customDate}
            onChange={(e) => {
              setCustomDate(e.target.value);
              emitCustom(e.target.value, customTime, force);
            }}
          />
          <TextField
            label={t('booking.time')}
            type="time"
            step={300}
            value={customTime}
            onChange={(e) => {
              setCustomTime(e.target.value);
              emitCustom(customDate, e.target.value, force);
            }}
          />
        </div>
        <p className="text-sm text-ink-600">{t('booking.customHint')}</p>
        <Checkbox
          label={t('booking.force')}
          checked={force}
          onChange={(e) => {
            setForce(e.target.checked);
            emitCustom(customDate, customTime, e.target.checked);
          }}
        />
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        {modes}
        <p className="rounded-xl bg-ink-50 p-4 text-sm text-ink-700">{t('booking.pickServicesFirst')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {modes}
      {days.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="flex gap-2 overflow-hidden">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} rounded="xl" className="h-24 w-[4.25rem] shrink-0" />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} rounded="pill" className="h-11" />
            ))}
          </div>
        </div>
      ) : days.isError ? (
        <Alert>{errorMessage(t, days.error)}</Alert>
      ) : !firstFree ? (
        <div className="rounded-xl bg-ink-50 p-4 text-sm text-ink-700">
          <p className="font-semibold">{t('booking.noFreeTimes')}</p>
          <button type="button" onClick={() => switchMode('custom')} className="mt-1 font-semibold text-rose-700 underline underline-offset-4">
            {t('booking.typeTime')}
          </button>
        </div>
      ) : (
        <>
          <DayStrip
            days={list.map((d) => ({ date: d.date, count: d.slots, disabled: d.slots === 0 }))}
            selected={activeDate}
            onSelect={(next) => {
              setDate(next);
              if (value && zonedParts(value.start, timeZone).date !== next) onChange(null);
            }}
            today={today}
            label={t('booking.date')}
            describe={(count) => t('booking:flow.slotCount', { count })}
            indicator="dot"
          />
          <div aria-live="polite">
            {slots.isPending ? (
              <div className="grid grid-cols-4 gap-2" aria-busy="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} rounded="pill" className="h-11" />
                ))}
              </div>
            ) : slots.isError ? (
              <Alert>{errorMessage(t, slots.error)}</Alert>
            ) : slots.data.slots.length === 0 ? (
              <div className="rounded-xl bg-ink-50 p-4 text-sm text-ink-700">
                <p className="font-semibold">{t('booking:flow.noSlots')}</p>
                <button
                  type="button"
                  onClick={() => switchMode('custom', activeDate ?? undefined)}
                  className="mt-1 font-semibold text-rose-700 underline underline-offset-4"
                >
                  {t('booking.typeTime')}
                </button>
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm font-semibold text-ink-700 first-letter:uppercase">
                  {formatDayLong(dateToInstant(activeDate!), locale, 'UTC')}
                </p>
                <TimeSlots
                  slots={slots.data.slots}
                  selected={value && !value.custom ? value.start : null}
                  onSelect={(slot) => onChange({ start: slot.start, staffIds: slot.staffIds, custom: false, force: false })}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
