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
import {
  dayParts,
  formatDateTime,
  formatTime,
  fullName,
  relativeDayLabel,
  zonedDate,
} from '@/lib/format';
import type { StaffAppointment } from '@/types/api';
import { adminQueries } from '../api';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useStatusChange, useStudioToday } from '../components/hooks';
import { relativeTime } from '../components/utils';

/** On white (the sheet), or on the peach field of the card on "Today", with its own ink. */
const TONES = {
  plain: {
    line: 'border-ink-100',
    leaf: 'bg-peach-50',
    hover: 'hover:bg-ink-50 focus-visible:bg-ink-50',
    muted: 'text-ink-600',
  },
  peach: {
    line: 'border-peach-200/70',
    leaf: 'bg-white',
    hover: 'hover:bg-peach-100/70 focus-visible:bg-peach-100/70',
    muted: 'text-peach-800',
  },
};
type Tone = (typeof TONES)[keyof typeof TONES];

/**
 * Booking requests with their two quick answers, as on the booking's own page: Confirm at once,
 * Decline through the same sheet with an optional reason. An answered request leaves the list
 * straight away (the pending list refreshes behind it).
 */
export function RequestList({
  requests,
  withMaster,
  onOpen,
  tone = 'plain',
  className,
}: {
  requests: StaffAppointment[];
  /** Each request's master: for whoever sees the whole studio, when it has several. */
  withMaster: boolean;
  /** A request was opened (the sheet closes behind it). */
  onOpen?: () => void;
  tone?: keyof typeof TONES;
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
        ? {
            ...old,
            appointments: old.appointments.filter((a) => a.id !== updated.id),
            total: old.total - 1,
          }
        : old,
    );
  });
  const busy = (id: string, status: string) =>
    setStatus.isPending && setStatus.variables?.id === id && setStatus.variables.status === status;

  return (
    <>
      <ul className={className}>
        {requests.map((a) => (
          <RequestRow
            key={a.id}
            appointment={a}
            clock={clock}
            tone={TONES[tone]}
            withMaster={withMaster}
            onOpen={onOpen}
            confirming={busy(a.id, 'confirmed')}
            disabled={setStatus.isPending}
            error={
              setStatus.variables?.id === a.id && setStatus.variables.status === 'confirmed'
                ? setStatus.error
                : null
            }
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
        onConfirm={() =>
          declining &&
          setStatus.mutate({
            id: declining.id,
            status: 'cancelled',
            cancelReason: reason.trim(),
            toast: 'declined',
          })
        }
        title={t('appointment.declineTitle')}
        description={
          declining ? t('appointment.declineText', { name: fullName(declining.client) }) : undefined
        }
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
  tone,
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
  tone: Tone;
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
    // A line above every request but the first (a hidden one takes its line along).
    <li
      className={cx(
        '@container mt-4 border-t pt-4 first:mt-0 first:border-t-0 first:pt-0',
        tone.line,
      )}
    >
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:gap-4">
        <Link
          to={lp(`/admin/appointments/${a.id}`)}
          onClick={onOpen}
          // A named group: inside a sheet (itself a `group`), hovering the sheet must not underline every name.
          className={cx(
            'group/request -m-2 flex min-w-0 flex-1 items-start gap-3 rounded-xl p-2 transition-colors',
            tone.hover,
          )}
        >
          <span
            className={cx(
              'flex w-12 shrink-0 flex-col items-center rounded-xl pb-1.5 pt-1',
              tone.leaf,
            )}
          >
            <span className="text-xs font-semibold capitalize text-peach-800">{leaf.month}</span>
            <span className="tabular text-xl font-extrabold leading-none tracking-[-0.03em]">
              {leaf.day}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 break-words font-semibold group-hover/request:underline">
                {fullName(a.client)}
              </span>
              <time
                dateTime={a.createdAt}
                title={formatDateTime(a.createdAt, locale, timeZone)}
                className={cx('shrink-0 text-xs', tone.muted)}
              >
                <span className="sr-only">{t('requests.sent')} </span>
                {relativeTime(a.createdAt, locale, now)}
              </time>
            </span>
            <span className="block text-sm font-semibold first-letter:uppercase">
              {day}, <span className="tabular">{formatTime(a.start, locale, timeZone)}</span>
              {withMaster && a.staff ? ` · ${a.staff.name}` : ''}
            </span>
            <span className={cx('block text-sm', tone.muted)}>
              {a.services.map((s) => pick(s.name)).join(', ')}
            </span>
            {a.nailShape ? (
              <span className={cx('block text-sm', tone.muted)}>
                {t('booking:shape.line', { shape: t(`booking:shape.${a.nailShape}`) })}
              </span>
            ) : null}
            {a.clientStats.noShows > 0 ? (
              <span className="mt-0.5 block text-xs font-semibold text-red-700">
                {t('appointment.noShowCount', { count: a.clientStats.noShows })}
              </span>
            ) : null}
          </span>
        </Link>
        <div className="grid grid-cols-2 gap-2 @xl:w-80 @xl:shrink-0">
          <Button size="md" variant="outline" disabled={disabled} onClick={onDecline}>
            {t('appointment.decline')}
          </Button>
          <Button
            size="md"
            loading={confirming}
            disabled={disabled && !confirming}
            onClick={onConfirm}
          >
            {t('appointment.confirm')}
          </Button>
        </div>
      </div>
      {error ? <Alert className="mt-3">{errorMessage(t, error)}</Alert> : null}
    </li>
  );
}
