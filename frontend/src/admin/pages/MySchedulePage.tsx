import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { SectionHeading } from '@/components/layout/PageHeader';
import { Button, EmptyState, SegmentedControl, Skeleton, toast } from '@/components/ui';
import { AddIcon, EventBusyIcon, ScheduleIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDateTime } from '@/lib/format';
import { isApiError } from '@/services/api/client';
import { adminApi, adminQueries, type AdminStaff, type OutsideHoursBooking, type TimeOff, type WeeklyHours } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { HoursEditor } from '../components/HoursEditor';
import { useStudioToday } from '../components/hooks';
import { TimeOffEditor } from '../components/TimeOffEditor';
import { TimeOffRow } from '../components/TimeOffRow';
import { dayIssue } from '../components/utils';

const BUFFERS = ['0', '5', '10', '15', '20', '30'] as const;
type Buffer = (typeof BUFFERS)[number];
const asBuffer = (minutes: number | undefined): Buffer => BUFFERS.find((b) => Number(b) === (minutes ?? 0)) ?? '0';

/**
 * A master's own week, as in Fresha or Booksy: working hours (a lunch break is two stretches),
 * a break kept free after every client, and time off. Clients can book them only inside it.
 */
export default function MySchedulePage() {
  const { t } = useTranslation(['admin', 'common']);
  const me = useQuery(adminQueries.myStaff());

  return (
    <div className="pb-8">
      <AdminHeader title={t('mySchedule.title')} subtitle={t('mySchedule.subtitle')} />
      <div className="gutter-x flex flex-col gap-8 lg:px-0">
        {me.isPending ? (
          <Skeleton rounded="xl" className="h-96" />
        ) : me.isError ? (
          isApiError(me.error, 'NOT_FOUND') ? (
            <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
              <EmptyState icon={ScheduleIcon} tone="cyan" title={t('mySchedule.notMaster')} description={t('mySchedule.notMasterText')} />
            </div>
          ) : (
            <Alert>{errorMessage(t, me.error)}</Alert>
          )
        ) : (
          <>
            <WeekForm key={me.data.id} staff={me.data} />
            <MyTimeOff staff={me.data} />
          </>
        )}
      </div>
    </div>
  );
}

function WeekForm({ staff }: { staff: AdminStaff }) {
  const { t } = useTranslation(['admin', 'common']);
  const { lp, locale } = useLocale();
  const { timeZone } = useStudioToday();
  const queryClient = useQueryClient();
  const [weekly, setWeekly] = useState<WeeklyHours>(() => Array.from({ length: 7 }, (_, day) => staff.weekly[day] ?? []));
  const [buffer, setBuffer] = useState<Buffer>(asBuffer(staff.bufferMin));
  const [outside, setOutside] = useState<OutsideHoursBooking[] | null>(null);

  const dirty = JSON.stringify(weekly) !== JSON.stringify(staff.weekly) || Number(buffer) !== (staff.bufferMin ?? 0);
  const invalid = weekly.some((day) => dayIssue(day) !== null);

  const save = useMutation({
    mutationFn: () => adminApi.updateMyStaff({ weekly, bufferMin: Number(buffer) }),
    onSuccess: ({ staff: updated, outsideHours }) => {
      queryClient.setQueryData(adminQueries.myStaff().queryKey, updated);
      for (const queryKey of [['admin', 'staff'], ['staff'], ['availability-days'], ['availability-slots']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      setOutside(outsideHours);
      toast.success(t('mySchedule.saved'));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!invalid && dirty) save.mutate();
  };

  return (
    <form className="flex flex-col gap-8" onSubmit={submit} noValidate>
      <section aria-labelledby="hours-title">
        <SectionHeading id="hours-title" title={t('mySchedule.hoursTitle')} />
        <p className="-mt-1 mb-3 text-sm text-ink-600">{t('mySchedule.hoursText')}</p>
        <HoursEditor value={weekly} onChange={setWeekly} />
      </section>

      <section aria-labelledby="buffer-title">
        <SectionHeading id="buffer-title" title={t('mySchedule.bufferTitle')} />
        <p className="-mt-1 mb-3 text-sm text-ink-600">{t('mySchedule.bufferText')}</p>
        {/* Bare numbers fit six choices on a phone; the unit is in the text above and the label. */}
        <SegmentedControl
          label={t('mySchedule.bufferLabel')}
          value={buffer}
          onChange={setBuffer}
          options={BUFFERS.map((b) => ({ value: b, label: b === '0' ? t('mySchedule.bufferNone') : b }))}
          className="tabular w-full sm:w-auto"
        />
      </section>

      {outside && outside.length > 0 ? (
        <Alert tone="warning">
          <p className="font-semibold">{t('mySchedule.outside', { count: outside.length })}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {outside.slice(0, 6).map((booking) => (
              <li key={booking.id}>
                <Link to={lp(`/admin/appointments/${booking.id}`)} className="font-semibold underline underline-offset-4">
                  <span className="first-letter:uppercase">{formatDateTime(booking.start, locale, timeZone)}</span> · {booking.clientName}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {save.isError ? <Alert>{errorMessage(t, save.error)}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
        <Button type="submit" size="md" disabled={!dirty || invalid} loading={save.isPending} className="min-w-32">
          {t('common.save')}
        </Button>
        {dirty ? (
          <Button
            size="md"
            variant="ghost"
            onClick={() => {
              setWeekly(Array.from({ length: 7 }, (_, day) => staff.weekly[day] ?? []));
              setBuffer(asBuffer(staff.bufferMin));
              save.reset();
            }}
          >
            {t('appointment.discard')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function MyTimeOff({ staff }: { staff: AdminStaff }) {
  const { t } = useTranslation(['admin', 'common']);
  const { today, now } = useStudioToday();
  const queryClient = useQueryClient();
  const timeOff = useQuery(adminQueries.timeOff({ from: today, to: addDays(today, 365) }));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TimeOff | null>(null);
  const mine = (timeOff.data ?? []).filter((entry) => entry.staffId === staff.id && new Date(entry.end).getTime() > now);

  const remove = useMutation({
    mutationFn: (entry: TimeOff) => adminApi.deleteTimeOff(entry.id),
    onSuccess: () => {
      for (const queryKey of [['admin', 'time-off'], ['availability-days'], ['availability-slots']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.success(t('timeOff.deleted'));
      setRemoving(null);
    },
  });

  return (
    <section aria-labelledby="my-time-off-title">
      <SectionHeading
        id="my-time-off-title"
        title={t('timeOff.title')}
        action={
          <Button size="sm" variant="outline" icon={AddIcon} onClick={() => setAdding(true)}>
            {t('timeOff.add')}
          </Button>
        }
      />
      <p className="-mt-1 mb-3 text-sm text-ink-600">{t('mySchedule.timeOffText')}</p>
      {timeOff.isPending ? (
        <Skeleton rounded="xl" className="h-24" />
      ) : timeOff.isError ? (
        <Alert>{errorMessage(t, timeOff.error)}</Alert>
      ) : mine.length === 0 ? (
        <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
          <EmptyState icon={EventBusyIcon} tone="cyan" title={t('timeOff.empty')} description={t('timeOff.emptyText')} />
        </div>
      ) : (
        <ul className="flex flex-col rounded-2xl bg-white p-1 ring-1 ring-inset ring-ink-100">
          {mine.map((entry) => (
            <TimeOffRow key={entry.id} entry={entry} member={staff} now={now} onDelete={() => setRemoving(entry)} />
          ))}
        </ul>
      )}

      {adding ? <TimeOffEditor masters={[staff]} canCloseStudio={false} today={today} onClose={() => setAdding(false)} /> : null}
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('timeOff.deleteTitle')}
        description={t('timeOff.deleteText')}
        confirmLabel={t('timeOff.delete')}
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </section>
  );
}
