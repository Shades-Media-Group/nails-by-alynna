import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { NailArt } from '@/components/brand/NailArt';
import { Alert } from '@/components/common/Alert';
import { Avatar, Button, ButtonLink, EmptyState, ListGroup, ListRow, Skeleton, Textarea, toast, type ButtonVariant } from '@/components/ui';
import { CallIcon, EmailIcon, EventBusyIcon, PersonIcon, WhatsAppIcon } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { dateToInstant, dayParts, formatDateTime, formatDayLong, formatDuration, formatPhone, formatPrice, formatTime, fullName, zonedDate } from '@/lib/format';
import { SWATCH } from '@/lib/swatch';
import { isApiError } from '@/services/api/client';
import type { StaffAppointment } from '@/types/api';
import { adminApi, adminQueries } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useNow, useRefreshBookings, useStatusChange } from '../components/hooks';
import { RescheduleSheet } from '../components/RescheduleSheet';
import { StatusBadge } from '../components/StatusBadge';
import { isPlaceholderEmail, telHref, whatsappHref } from '../components/utils';

type SheetKind = 'cancel' | 'noShow' | 'restoreForce' | 'reschedule' | null;

interface Action {
  key: string;
  label: string;
  variant: ButtonVariant;
  onClick: () => void;
  loading?: boolean;
  danger?: boolean;
}

/** One booking at the desk: when, who, what, and every move its status allows. */
export default function AppointmentPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { lp } = useLocale();
  const { timeZone } = useStudio();
  const queryClient = useQueryClient();
  const refresh = useRefreshBookings();
  const appointment = useQuery(adminQueries.appointment(id));
  const now = useNow(30_000);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [reason, setReason] = useState('');
  const setStatus = useStatusChange(() => setSheet(null));

  if (appointment.isPending) {
    return (
      <div className="pb-8">
        <AdminHeader title={t('appointment.title')} backTo={lp('/admin/calendar')} />
        <div className="gutter-x mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:px-0">
          <div className="flex flex-col gap-4">
            <Skeleton rounded="xl" className="h-40" />
            <Skeleton rounded="xl" className="h-12" />
            <Skeleton rounded="xl" className="h-48" />
          </div>
          <Skeleton rounded="xl" className="h-64" />
        </div>
      </div>
    );
  }
  if (appointment.isError) {
    return (
      <div className="pb-8">
        <AdminHeader title={t('appointment.title')} backTo={lp('/admin/calendar')} />
        {isApiError(appointment.error, 'NOT_FOUND') ? (
          <EmptyState
            icon={EventBusyIcon}
            tone="peach"
            title={t('appointment.notFound')}
            action={
              <ButtonLink to={lp('/admin/calendar')} size="md" variant="soft">
                {t('appointment.toCalendar')}
              </ButtonLink>
            }
          />
        ) : (
          <div className="gutter-x mt-6 lg:px-0">
            <Alert>{errorMessage(t, appointment.error)}</Alert>
          </div>
        )}
      </div>
    );
  }

  const a = appointment.data;
  const started = new Date(a.start).getTime() <= now;
  const busy = (status: string) => setStatus.isPending && setStatus.variables?.status === status;
  const open = (kind: Exclude<SheetKind, null>) => {
    setReason('');
    setStatus.reset();
    setSheet(kind);
  };
  const restore = () =>
    setStatus.mutate(
      { id: a.id, status: 'confirmed', toast: 'restored' },
      { onError: (error) => (isApiError(error, 'SLOT_TAKEN') ? setSheet('restoreForce') : undefined) },
    );

  const actions: Action[] = [];
  if (a.status === 'pending') {
    actions.push({ key: 'confirm', label: t('appointment.confirm'), variant: 'primary', loading: busy('confirmed'), onClick: () => setStatus.mutate({ id: a.id, status: 'confirmed' }) });
    actions.push({ key: 'decline', label: t('appointment.decline'), variant: 'outline', danger: true, onClick: () => open('cancel') });
    actions.push({ key: 'reschedule', label: t('appointment.reschedule'), variant: 'soft', onClick: () => open('reschedule') });
  } else if (a.status === 'confirmed') {
    if (started) {
      actions.push({ key: 'complete', label: t('appointment.complete'), variant: 'primary', loading: busy('completed'), onClick: () => setStatus.mutate({ id: a.id, status: 'completed' }) });
      actions.push({ key: 'noShow', label: t('appointment.noShow'), variant: 'outline', onClick: () => open('noShow') });
    }
    actions.push({ key: 'reschedule', label: t('appointment.reschedule'), variant: started ? 'soft' : 'primary', onClick: () => open('reschedule') });
    actions.push({ key: 'cancel', label: t('appointment.cancel'), variant: 'outline', danger: true, onClick: () => open('cancel') });
  } else if (a.status === 'completed') {
    actions.push({ key: 'noShow', label: t('appointment.noShow'), variant: 'outline', onClick: () => open('noShow') });
    actions.push({ key: 'reopen', label: t('appointment.reopen'), variant: 'ghost', loading: busy('confirmed'), onClick: () => setStatus.mutate({ id: a.id, status: 'confirmed', toast: 'reopened' }) });
  } else if (a.status === 'no_show') {
    actions.push({ key: 'complete', label: t('appointment.complete'), variant: 'outline', loading: busy('completed'), onClick: () => setStatus.mutate({ id: a.id, status: 'completed' }) });
    actions.push({ key: 'reopen', label: t('appointment.reopen'), variant: 'ghost', loading: busy('confirmed'), onClick: () => setStatus.mutate({ id: a.id, status: 'confirmed', toast: 'reopened' }) });
  } else {
    actions.push({ key: 'restore', label: t('appointment.restore'), variant: 'primary', loading: busy('confirmed'), onClick: restore });
  }
  const inlineError = sheet === null && setStatus.isError && !isApiError(setStatus.error, 'SLOT_TAKEN') ? setStatus.error : null;

  return (
    <div className="pb-8">
      <AdminHeader
        title={t('appointment.title')}
        subtitle={
          <span>
            {t('appointment.code')} <span className="tabular font-semibold tracking-wide text-ink-800">{a.code}</span>
          </span>
        }
        backTo={`${lp('/admin/calendar')}?date=${zonedDate(new Date(a.start), timeZone)}`}
        backInHistory
      />

      <div className="gutter-x mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:px-0">
        <div className="flex min-w-0 flex-col gap-4">
          <WhenCard appointment={a} running={(a.status === 'pending' || a.status === 'confirmed') && started && new Date(a.end).getTime() > now} />

          <div className="grid grid-cols-2 gap-2">
            {actions.map((action) => (
              <Button
                key={action.key}
                size="md"
                variant={action.variant}
                loading={action.loading}
                disabled={setStatus.isPending && !action.loading}
                onClick={action.onClick}
                className={cx(action.danger && 'text-red-700', actions.length % 2 === 1 && action === actions.at(-1) && 'col-span-2')}
              >
                {action.label}
              </Button>
            ))}
          </div>
          {inlineError ? <Alert>{errorMessage(t, inlineError)}</Alert> : null}

          <Services appointment={a} />
          <Notes key={a.id} appointment={a} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <ClientCard appointment={a} />
          <Details appointment={a} />
        </div>
      </div>

      <ConfirmSheet
        open={sheet === 'cancel'}
        onClose={() => setSheet(null)}
        onConfirm={() =>
          setStatus.mutate({ id: a.id, status: 'cancelled', cancelReason: reason.trim(), toast: a.status === 'pending' ? 'declined' : 'cancelled' })
        }
        title={a.status === 'pending' ? t('appointment.declineTitle') : t('appointment.cancelTitle')}
        description={a.status === 'pending' ? t('appointment.declineText', { name: fullName(a.client) }) : t('appointment.cancelText', { name: fullName(a.client) })}
        confirmLabel={a.status === 'pending' ? t('appointment.decline') : t('appointment.cancelConfirm')}
        cancelLabel={t('appointment.keep')}
        loading={busy('cancelled')}
        error={sheet === 'cancel' ? setStatus.error : null}
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

      <ConfirmSheet
        open={sheet === 'noShow'}
        onClose={() => setSheet(null)}
        onConfirm={() => setStatus.mutate({ id: a.id, status: 'no_show' })}
        title={t('appointment.noShowTitle')}
        description={t('appointment.noShowText', { name: fullName(a.client) })}
        confirmLabel={t('appointment.noShowConfirm')}
        loading={busy('no_show')}
        error={sheet === 'noShow' ? setStatus.error : null}
      />

      <ConfirmSheet
        open={sheet === 'restoreForce'}
        onClose={() => setSheet(null)}
        onConfirm={() => setStatus.mutate({ id: a.id, status: 'confirmed', force: true, toast: 'restored' })}
        title={t('appointment.restoreTakenTitle')}
        description={t('appointment.restoreTakenText')}
        confirmLabel={t('appointment.restoreAnyway')}
        tone="primary"
        loading={busy('confirmed')}
        error={sheet === 'restoreForce' && !isApiError(setStatus.error, 'SLOT_TAKEN') ? setStatus.error : null}
      />

      {sheet === 'reschedule' ? (
        <RescheduleSheet
          appointment={a}
          onClose={() => setSheet(null)}
          onDone={(updated) => {
            queryClient.setQueryData(adminQueries.appointment(updated.id).queryKey, updated);
            refresh(updated.client.id);
            toast.success(t('appointment.toast.moved'));
            setSheet(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** When, how long, with whom, and where it stands, on the ink card used for what matters now. */
function WhenCard({ appointment: a, running }: { appointment: StaffAppointment; running: boolean }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const date = zonedDate(new Date(a.start), timeZone);
  const leaf = dayParts(date, locale);
  const active = a.status === 'pending' || a.status === 'confirmed';

  return (
    <section aria-label={t('appointment.when')} className={cx('rounded-2xl p-4 sm:p-5', active ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-900')}>
      <div className="flex items-start gap-4">
        <span className={cx('flex w-14 shrink-0 flex-col items-center rounded-xl bg-white pb-2 pt-1.5', active ? 'text-ink-900' : 'text-ink-500')}>
          <span className="text-xs font-semibold capitalize text-rose-600">{leaf.month}</span>
          <span className="tabular text-[1.625rem] font-extrabold leading-none tracking-[-0.03em]">{leaf.day}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold first-letter:uppercase">{formatDayLong(dateToInstant(date), locale, 'UTC')}</p>
          <p className="tabular mt-0.5 text-h2 font-extrabold">
            {formatTime(a.start, locale, timeZone)}–{formatTime(a.end, locale, timeZone)}
          </p>
          <p className={cx('mt-1 text-sm', active ? 'text-white/70' : 'text-ink-600')}>
            {formatDuration(t, a.durationMin)}
            {a.staff ? ` · ${a.staff.name}` : ''}
          </p>
        </div>
        <StatusBadge status={a.status} className="shrink-0" />
      </div>
      {a.status === 'pending' ? (
        <p className="mt-4 rounded-lg bg-white/8 px-3 py-2 text-sm text-peach-200">{t('appointment.pendingNote')}</p>
      ) : running ? (
        <p className="mt-4 rounded-lg bg-white/8 px-3 py-2 text-sm text-mint-100">{t('appointment.runningNote')}</p>
      ) : a.status === 'cancelled' ? (
        <p className="mt-4 text-sm text-red-700">
          {t(a.cancelledBy === 'client' ? 'appointment.cancelledByClient' : 'appointment.cancelledByStudio', {
            date: a.cancelledAt ? formatDateTime(a.cancelledAt, locale, timeZone) : '',
          })}
          {a.cancelReason ? <span className="mt-1 block text-ink-700">{t('appointment.reasonValue', { reason: a.cancelReason })}</span> : null}
        </p>
      ) : null}
    </section>
  );
}

function Services({ appointment: a }: { appointment: StaffAppointment }) {
  const { t } = useTranslation(['admin', 'booking', 'common']);
  const pick = useI18nText();
  const { currency } = useStudio();
  const catalog = useQuery(adminQueries.catalog());
  const services = new Map((catalog.data?.services ?? []).map((s) => [s.id, s]));
  const categories = new Map((catalog.data?.categories ?? []).map((c) => [c.id, c]));
  return (
    <section aria-labelledby="services-title" className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
      <h2 id="services-title" className="px-4 pt-4 text-h3 font-extrabold">
        {t('booking.services')}
      </h2>
      <ul className="mt-1 divide-y divide-ink-100">
        {a.services.map((line) => {
          const service = services.get(line.id);
          const color = (service && categories.get(service.categoryId)?.color) || 'blush';
          return (
            <li key={line.id} className="flex items-center gap-3 px-4 py-3">
              <span className={cx('flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg', SWATCH[color].field)}>
                <NailArt art={service?.art ?? 'gel'} color={color} className="w-10" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem] font-semibold leading-snug">{pick(line.name)}</span>
                <span className="block text-sm text-ink-600">{formatDuration(t, line.durationMin)}</span>
              </span>
              <span className="tabular shrink-0 text-[0.9375rem] font-semibold">{formatPrice(t, line.price, currency, line.priceFrom)}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between border-t border-ink-100 px-4 py-3">
        <span className="font-bold">{t('appointment.total')}</span>
        <span className="tabular text-lg font-extrabold">{formatPrice(t, a.totalPrice, currency, a.priceFrom)}</span>
      </div>
    </section>
  );
}

/** The note the client sees and the team's private note, saved together. */
function Notes({ appointment: a }: { appointment: StaffAppointment }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(a.notes);
  const [staffNotes, setStaffNotes] = useState(a.staffNotes);
  const changed = {
    ...(notes.trim() !== a.notes ? { notes: notes.trim() } : {}),
    ...(staffNotes.trim() !== a.staffNotes ? { staffNotes: staffNotes.trim() } : {}),
  };
  const dirty = Object.keys(changed).length > 0;
  const save = useMutation({
    mutationFn: () => adminApi.updateAppointment(a.id, changed),
    onSuccess: (updated) => {
      queryClient.setQueryData(adminQueries.appointment(updated.id).queryKey, updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'client', updated.client.id] });
      toast.success(t('common.saved'));
    },
  });
  return (
    <section aria-labelledby="notes-title" className="flex flex-col gap-4 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
      <h2 id="notes-title" className="text-h3 font-extrabold">
        {t('appointment.notes')}
      </h2>
      <Textarea
        label={t('appointment.clientNote')}
        hint={t('appointment.clientNoteHint')}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={500}
        rows={2}
      />
      <Textarea
        label={t('appointment.staffNote')}
        hint={t('appointment.staffNoteHint')}
        value={staffNotes}
        onChange={(e) => setStaffNotes(e.target.value)}
        maxLength={1000}
        rows={3}
      />
      {save.isError ? <Alert>{errorMessage(t, save.error)}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="md" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()} className="min-w-32">
          {t('common.save')}
        </Button>
        {dirty ? (
          <Button
            size="md"
            variant="ghost"
            onClick={() => {
              setNotes(a.notes);
              setStaffNotes(a.staffNotes);
            }}
          >
            {t('appointment.discard')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ClientCard({ appointment: a }: { appointment: StaffAppointment }) {
  const { t } = useTranslation(['admin', 'common']);
  const { lp } = useLocale();
  const email = isPlaceholderEmail(a.client.email) ? null : a.client.email;
  return (
    <section aria-labelledby="client-title" className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
        <Avatar name={a.client.name} surname={a.client.surname} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 id="client-title" className="break-words text-h3 font-extrabold">
            {fullName(a.client)}
          </h2>
          <p className="mt-0.5 text-sm text-ink-600">
            {t('client.visits', { count: a.clientStats.visits })}
            {a.clientStats.noShows > 0 ? (
              <span className="font-semibold text-red-700"> · {t('appointment.noShowCount', { count: a.clientStats.noShows })}</span>
            ) : null}
          </p>
        </div>
      </div>
      <ListGroup>
        {a.client.phone ? (
          <>
            <ListRow icon={CallIcon} label={<span className="tabular">{formatPhone(a.client.phone)}</span>} description={t('client.call')} href={telHref(a.client.phone)} />
            <ListRow icon={WhatsAppIcon} label="WhatsApp" description={t('client.whatsappText')} href={whatsappHref('', a.client.phone)} external />
          </>
        ) : null}
        {email ? <ListRow icon={EmailIcon} label={<span className="break-words">{email}</span>} description={t('client.email')} href={`mailto:${email}`} /> : null}
        <ListRow icon={PersonIcon} label={t('appointment.openClient')} description={t('appointment.openClientText')} to={lp(`/admin/clients/${a.client.id}`)} />
      </ListGroup>
    </section>
  );
}

function Details({ appointment: a }: { appointment: StaffAppointment }) {
  const { t } = useTranslation(['admin', 'common']);
  const { locale } = useLocale();
  const { timeZone } = useStudio();
  const active = a.status === 'pending' || a.status === 'confirmed';
  const rows: Array<[string, string]> = [
    [t('appointment.source'), a.source === 'client' ? t('appointment.sourceClient') : t('appointment.sourceStudio')],
    [t('appointment.createdAt'), formatDateTime(a.createdAt, locale, timeZone)],
    [t('appointment.code'), a.code],
  ];
  if (active) {
    rows.push([
      t('appointment.clientChanges'),
      a.canChange
        ? t('appointment.clientChangesUntil', { date: formatDateTime(a.changeDeadline, locale, timeZone) })
        : t('appointment.clientChangesClosed'),
    ]);
  }
  return (
    <section aria-labelledby="details-title" className="rounded-2xl bg-ink-50 p-4">
      <h2 id="details-title" className="text-h3 font-extrabold">
        {t('appointment.details')}
      </h2>
      <dl className="mt-2 flex flex-col divide-y divide-ink-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-sm text-ink-600">{label}</dt>
            <dd className="text-sm font-semibold first-letter:uppercase sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
