import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert } from '@/components/common/Alert';
import { Button, Textarea } from '@/components/ui';
import { useI18nText } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { dayParts, formatDateTime, formatTime, fullName, relativeDayLabel, zonedDate } from '@/lib/format';
import type { StaffAppointment } from '@/types/api';
import { adminQueries } from '../api';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useStatusChange, useStudioToday } from '../components/hooks';
import { relativeTime } from '../components/utils';

/**
 * Booking requests with their two quick answers, as on the booking's own page: Confirm at once,
 * Decline through the same sheet with an optional reason. An answered request leaves the list
 * straight away (the pending list refreshes behind it).
 */
export function RequestList({
  requests,
  withMaster,
  onOpen,
  className,
}: {
  requests: StaffAppointment[];
  /** Each request's master: for whoever sees the whole studio, when it has several. */
  withMaster: boolean;
  /** A request was opened (the sheet closes behind it). */
  onOpen?: () => void;
  className?: string;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const clock = useStudioToday();
  const [declining, setDeclining] = useState<StaffAppointment | null>(null);
  const [reason, setReason] = useState('');
  const setStatus = useStatusChange((updated) => {
    setDeclining(null);
    queryClient.setQueryData(adminQueries.pendingRequests().queryKey, (old) =>
      old?.appointments.some((a) => a.id === updated.id)
        ? { ...old, appointments: old.appointments.filter((a) => a.id !== updated.id), total: old.total - 1 }
        : old,
    );
  });
  const busy = (id: string, status: string) => setStatus.isPending && setStatus.variables?.id === id && setStatus.variables.status === status;

  return (
    <>
      <ul className={cx('flex flex-col gap-2', className)}>
        {requests.map((a) => (
          <RequestRow
            key={a.id}
            appointment={a}
            clock={clock}
            withMaster={withMaster}
            onOpen={onOpen}
            confirming={busy(a.id, 'confirmed')}
            disabled={setStatus.isPending}
            error={setStatus.variables?.id === a.id && setStatus.variables.status === 'confirmed' ? setStatus.error : null}
            onConfirm={() => setStatus.mutate({ id: a.id, status: 'confirmed' })}
            onDecline={() => {
              setReason('');
              setStatus.reset();
              setDeclining(a);
            }}
          />
        ))}
      </ul>

      <ConfirmSheet
        open={declining !== null}
        onClose={() => setDeclining(null)}
        onConfirm={() => declining && setStatus.mutate({ id: declining.id, status: 'cancelled', cancelReason: reason.trim(), toast: 'declined' })}
        title={t('appointment.declineTitle')}
        description={declining ? t('appointment.declineText', { name: fullName(declining.client) }) : undefined}
        confirmLabel={t('appointment.decline')}
        cancelLabel={t('appointment.keep')}
        loading={declining ? busy(declining.id, 'cancelled') : false}
        error={setStatus.variables?.status === 'cancelled' ? setStatus.error : null}
      >
        <Textarea
          label={t('appointment.reason')}
          hint={t('appointment.reasonHint')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={3}
        />
      </ConfirmSheet>
    </>
  );
}

/**
 * One request: the day on a leaf, who, when (in words: "Tomorrow, 14:00"), what, and how long
 * ago it came in. The whole top opens the booking; a wide row puts the answers on its right.
 */
function RequestRow({
  appointment: a,
  clock: { today, now, timeZone },
  withMaster,
  onOpen,
  confirming,
  disabled,
  error,
  onConfirm,
  onDecline,
}: {
  appointment: StaffAppointment;
  clock: ReturnType<typeof useStudioToday>;
  withMaster: boolean;
  onOpen?: () => void;
  confirming: boolean;
  disabled: boolean;
  error: unknown;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const date = zonedDate(new Date(a.start), timeZone);
  const leaf = dayParts(date, locale);
  const day = relativeDayLabel(t, date, today) ?? leaf.weekday;
  return (
    <li className="@container rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
      <div className="flex flex-col @xl:flex-row @xl:items-center">
        <Link
          to={lp(`/admin/appointments/${a.id}`)}
          onClick={onOpen}
          className="group flex min-w-0 flex-1 items-start gap-3 rounded-t-2xl px-3 pt-3 transition-colors hover:bg-ink-50/70 focus-visible:bg-ink-50/70 @xl:self-stretch @xl:rounded-r-none @xl:rounded-l-2xl @xl:pb-3"
        >
          <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-peach-50 pb-1.5 pt-1">
            <span className="text-xs font-semibold capitalize text-peach-800">{leaf.month}</span>
            <span className="tabular text-xl font-extrabold leading-none tracking-[-0.03em]">{leaf.day}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 break-words font-semibold group-hover:underline">{fullName(a.client)}</span>
              <time dateTime={a.createdAt} title={formatDateTime(a.createdAt, locale, timeZone)} className="shrink-0 text-xs text-ink-600">
                <span className="sr-only">{t('requests.sent')} </span>
                {relativeTime(a.createdAt, locale, now)}
              </time>
            </span>
            <span className="block text-sm font-semibold text-ink-800 first-letter:uppercase">
              {day}, <span className="tabular">{formatTime(a.start, locale, timeZone)}</span>
              {withMaster && a.staff ? ` · ${a.staff.name}` : ''}
            </span>
            <span className="block text-sm text-ink-600">{a.services.map((s) => pick(s.name)).join(', ')}</span>
            {a.nailShape ? (
              <span className="block text-sm text-ink-600">{t('booking:shape.line', { shape: t(`booking:shape.${a.nailShape}`) })}</span>
            ) : null}
            {a.clientStats.noShows > 0 ? (
              <span className="mt-0.5 block text-xs font-semibold text-red-700">{t('appointment.noShowCount', { count: a.clientStats.noShows })}</span>
            ) : null}
          </span>
        </Link>
        <div className="grid grid-cols-2 gap-2 p-3 @xl:w-72 @xl:shrink-0 @xl:pl-1">
          <Button size="md" variant="outline" disabled={disabled} onClick={onDecline}>
            {t('appointment.decline')}
          </Button>
          <Button size="md" loading={confirming} disabled={disabled && !confirming} onClick={onConfirm}>
            {t('appointment.confirm')}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="px-3 pb-3">
          <Alert>{errorMessage(t, error)}</Alert>
        </div>
      ) : null}
    </li>
  );
}
