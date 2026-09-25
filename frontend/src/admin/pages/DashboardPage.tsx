import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/app/auth';
import { Alert } from '@/components/common/Alert';
import { SectionHeading } from '@/components/layout/PageHeader';
import { Button, ButtonLink, EmptyState, Skeleton, Textarea, toast } from '@/components/ui';
import { AddIcon, CalendarIcon, CallIcon, ChevronRightIcon, EventIcon, GroupIcon, QrCodeIcon, type IconComponent } from '@/components/ui/icons';
import { useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { addDays, dateToInstant, dayParts, formatDayLong, formatDuration, formatPrice, formatTime, fullName, zonedDate } from '@/lib/format';
import { SWATCH } from '@/lib/swatch';
import type { StaffAppointment } from '@/types/api';
import { adminQueries, type DashboardStats } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useStatusChange, useStudioToday } from '../components/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { Timeline } from '../components/Timeline';
import { zonedParts } from '../components/time';
import { relativeTime, telHref } from '../components/utils';

/** The day at the desk: who is next, what waits for an answer, the schedule and the numbers. */
export default function DashboardPage() {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { user } = useAuth();
  const { lp, locale } = useLocale();
  const { today, now, timeZone } = useStudioToday();
  const stats = useQuery({ ...adminQueries.stats(), refetchInterval: 60_000 });
  const pending = useQuery({ ...adminQueries.appointments({ from: today, to: addDays(today, 60), status: 'pending' }), refetchInterval: 60_000 });
  const staff = useQuery(adminQueries.staff());
  const multiMaster = (staff.data ?? []).filter((s) => s.isActive && s.isBookable).length > 1;
  const [declining, setDeclining] = useState<StaffAppointment | null>(null);
  const [reason, setReason] = useState('');

  const minutes = zonedParts(new Date(now), timeZone).minutes;
  // Before 5:00 it's still the evening before (nobody says "good morning" at midnight).
  const greeting = minutes < 5 * 60 ? 'evening' : minutes < 12 * 60 ? 'morning' : minutes < 18 * 60 ? 'afternoon' : 'evening';

  const setStatus = useStatusChange(() => setDeclining(null));
  const busy = (id: string, status: string) => setStatus.isPending && setStatus.variables?.id === id && setStatus.variables.status === status;
  const quickError = (error: unknown) => toast.error(errorMessage(t, error));

  const quick: Array<{ to: string; label: string; icon: IconComponent; primary?: boolean }> = [
    { to: lp('/admin/appointments/new'), label: t('nav.newBooking'), icon: AddIcon, primary: true },
    { to: lp('/admin/scan'), label: t('dashboard.scan'), icon: QrCodeIcon },
    { to: lp('/admin/clients'), label: t('nav.clients'), icon: GroupIcon },
  ];

  return (
    <div className="pb-8">
      <AdminHeader
        title={t(`dashboard.greeting.${greeting}`, { name: user?.name ?? '' })}
        subtitle={<span className="block first-letter:uppercase">{formatDayLong(dateToInstant(today), locale, 'UTC')}</span>}
        actions={
          <div className="hidden items-center gap-2 lg:flex">
            {quick.map((item) => (
              <ButtonLink key={item.to} to={item.to} size="sm" variant={item.primary ? 'primary' : 'outline'} icon={item.icon}>
                {item.label}
              </ButtonLink>
            ))}
          </div>
        }
      />

      <div className="gutter-x mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:px-0">
        <div className="flex min-w-0 flex-col gap-8">
          <div>
            {stats.isPending ? (
              <Skeleton rounded="xl" className="h-44" />
            ) : stats.isError ? (
              <Alert>{errorMessage(t, stats.error)}</Alert>
            ) : (
              <NextUp stats={stats.data} now={now} multiMaster={multiMaster} />
            )}
          </div>

          <nav aria-label={t('dashboard.quickActions')} className="grid grid-cols-3 gap-2 lg:hidden">
            {quick.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cx(
                  'press flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-3 text-center',
                  item.primary ? 'bg-ink-900 text-white' : 'bg-white text-ink-900 ring-1 ring-inset ring-ink-100 hover:bg-ink-50',
                )}
              >
                <item.icon fontSize="inherit" className={cx('text-2xl', !item.primary && 'text-rose-700')} />
                <span className="text-sm font-semibold leading-tight">{item.label}</span>
              </Link>
            ))}
          </nav>

          {pending.data && pending.data.length > 0 ? (
            <section aria-labelledby="requests-title">
              <SectionHeading
                id="requests-title"
                title={t('dashboard.requests')}
                action={<span className="tabular rounded-pill bg-peach-50 px-2.5 py-0.5 text-sm font-bold text-peach-800">{pending.data.length}</span>}
              />
              <p className="-mt-1 mb-3 text-sm text-ink-600">{t('dashboard.requestsHint')}</p>
              <ul className="flex flex-col gap-2">
                {pending.data.map((a) => (
                  <RequestCard
                    key={a.id}
                    appointment={a}
                    confirming={busy(a.id, 'confirmed')}
                    disabled={setStatus.isPending}
                    onConfirm={() => setStatus.mutate({ id: a.id, status: 'confirmed' }, { onError: quickError })}
                    onDecline={() => {
                      setReason('');
                      setStatus.reset();
                      setDeclining(a);
                    }}
                  />
                ))}
              </ul>
            </section>
          ) : pending.isError ? (
            <Alert>{errorMessage(t, pending.error)}</Alert>
          ) : null}

          <section aria-labelledby="schedule-title">
            <SectionHeading
              id="schedule-title"
              title={t('dashboard.schedule')}
              action={
                <Link
                  to={lp('/admin/calendar')}
                  className="group inline-flex items-center gap-0.5 rounded-pill text-sm font-semibold text-ink-700 hover:text-ink-900"
                >
                  {t('dashboard.openCalendar')}
                  <ChevronRightIcon fontSize="inherit" className="text-lg transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1" />
                </Link>
              }
            />
            {stats.isPending ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} rounded="xl" className="h-20" />
                ))}
              </div>
            ) : stats.isError ? null : stats.data.today.appointments.length === 0 ? (
              <div className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
                <EmptyState
                  icon={EventIcon}
                  title={t('dashboard.emptyDay')}
                  description={t('dashboard.emptyDayText')}
                  action={
                    <ButtonLink to={lp('/admin/appointments/new')} size="md" icon={AddIcon}>
                      {t('nav.newBooking')}
                    </ButtonLink>
                  }
                />
              </div>
            ) : (
              <Timeline
                appointments={stats.data.today.appointments}
                now={now}
                showNow
                withMaster={multiMaster}
                completing={setStatus.isPending && setStatus.variables?.status === 'completed' ? setStatus.variables.id : null}
                onComplete={(a) => setStatus.mutate({ id: a.id, status: 'completed' }, { onError: quickError })}
              />
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="figures-title">
            <SectionHeading id="figures-title" title={t('dashboard.figures.title')} />
            {stats.isPending ? <Skeleton rounded="xl" className="h-72" /> : stats.isError ? null : <Figures stats={stats.data} />}
          </section>

          {stats.data ? (
            <section aria-labelledby="top-title">
              <SectionHeading id="top-title" title={t('dashboard.top.title')} />
              <TopServices stats={stats.data} />
            </section>
          ) : null}
        </div>
      </div>

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
    </div>
  );
}

/** The next visit (or the one in progress), big enough to read across the room. */
function NextUp({ stats, now, multiMaster }: { stats: DashboardStats; now: number; multiMaster: boolean }) {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { timeZone, currency } = useStudio();
  const next = stats.today.appointments.find(
    (a) => (a.status === 'confirmed' || a.status === 'pending') && new Date(a.end).getTime() > now,
  );

  if (!next) {
    return (
      <section aria-label={t('dashboard.nextUp')} className="flex items-center gap-4 rounded-2xl bg-ink-50 p-4">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-pill bg-white text-2xl text-rose-700">
          <CalendarIcon fontSize="inherit" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[1.0625rem] font-bold">{stats.today.total > 0 ? t('dashboard.dayDone') : t('dashboard.nothingToday')}</p>
          <p className="text-sm text-ink-600">{t('dashboard.next7', { count: stats.next7Days })}</p>
        </div>
      </section>
    );
  }

  const started = new Date(next.start).getTime() <= now;
  const names = next.services.map((s) => pick(s.name));
  return (
    <section aria-label={t('dashboard.nextUp')} className="rounded-2xl bg-ink-900 p-4 text-white sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tabular text-lg font-bold">
          {formatTime(next.start, locale, timeZone)}–{formatTime(next.end, locale, timeZone)}
        </p>
        <span className={cx('rounded-pill px-2.5 py-1 text-xs font-semibold', started ? 'bg-mint-500 text-ink-900' : 'bg-white/12 text-white')}>
          {started ? t('dashboard.inProgress') : relativeTime(next.start, locale, now)}
        </span>
      </div>
      <p className="mt-3 break-words text-h2 font-extrabold">{fullName(next.client)}</p>
      <p className="mt-1 text-[0.9375rem] text-white/75">{names.join(', ')}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/75">
        {multiMaster && next.staff ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cx('size-2 rounded-pill bg-current', SWATCH[next.staff.color].accent)} />
            {next.staff.name}
          </span>
        ) : null}
        <span>{formatDuration(t, next.durationMin)}</span>
        <span className="tabular font-semibold text-white">{formatPrice(t, next.totalPrice, currency, next.priceFrom)}</span>
        {next.status === 'pending' ? <StatusBadge status="pending" /> : null}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={lp(`/admin/appointments/${next.id}`)}
          className="press inline-flex h-11 items-center gap-1.5 rounded-pill bg-white px-5 text-[0.9375rem] font-semibold text-ink-900 hover:bg-blush-100"
        >
          {t('dashboard.openBooking')}
        </Link>
        {next.client.phone ? (
          <a
            href={telHref(next.client.phone)}
            className="press inline-flex h-11 items-center gap-1.5 rounded-pill bg-white/10 px-4 text-[0.9375rem] font-semibold text-white hover:bg-white/18"
          >
            <CallIcon fontSize="inherit" className="text-lg" />
            {t('client.call')}
          </a>
        ) : null}
      </div>
    </section>
  );
}

function RequestCard({
  appointment: a,
  confirming,
  disabled,
  onConfirm,
  onDecline,
}: {
  appointment: StaffAppointment;
  confirming: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation(['admin', 'booking']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const { timeZone } = useStudio();
  const leaf = dayParts(zonedDate(new Date(a.start), timeZone), locale);
  return (
    <li className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
      {/* The whole top of the card opens the booking, not just the name. */}
      <Link
        to={lp(`/admin/appointments/${a.id}`)}
        className="group flex items-start gap-3 rounded-t-2xl px-3 pt-3 transition-colors hover:bg-ink-50/70 focus-visible:bg-ink-50/70"
      >
        <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-peach-50 pb-1.5 pt-1">
          <span className="text-xs font-semibold capitalize text-peach-800">{leaf.month}</span>
          <span className="tabular text-xl font-extrabold leading-none tracking-[-0.03em]">{leaf.day}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words font-semibold group-hover:underline">{fullName(a.client)}</span>
          <span className="block text-sm text-ink-600">
            <span className="capitalize">{leaf.weekday}</span>, <span className="tabular">{formatTime(a.start, locale, timeZone)}</span>
            {a.staff ? ` · ${a.staff.name}` : ''}
          </span>
          <span className="block text-sm text-ink-600">{a.services.map((s) => pick(s.name)).join(', ')}</span>
          {a.clientStats.noShows > 0 ? (
            <span className="mt-0.5 block text-xs font-semibold text-red-700">{t('appointment.noShowCount', { count: a.clientStats.noShows })}</span>
          ) : null}
        </span>
      </Link>
      <div className="grid grid-cols-2 gap-2 p-3">
        <Button size="md" variant="outline" disabled={disabled} onClick={onDecline}>
          {t('appointment.decline')}
        </Button>
        <Button size="md" loading={confirming} disabled={disabled && !confirming} onClick={onConfirm}>
          {t('appointment.confirm')}
        </Button>
      </div>
    </li>
  );
}

function Figures({ stats }: { stats: DashboardStats }) {
  const { t } = useTranslation(['admin', 'common']);
  const currency = stats.currency;
  const occupancy = Math.round(stats.today.occupancy * 100);
  const cell = (label: string, value: ReactNode, sub?: ReactNode) => (
    <div className="flex flex-col bg-white p-4">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className="tabular mt-1 text-h2 font-extrabold">{value}</dd>
      {sub ? <dd className="mt-1 text-xs text-ink-600">{sub}</dd> : null}
    </div>
  );
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-ink-100 ring-1 ring-inset ring-ink-100">
      {cell(
        t('dashboard.figures.today'),
        stats.today.total,
        stats.today.completed > 0 ? t('dashboard.figures.completed', { count: stats.today.completed }) : undefined,
      )}
      {cell(t('dashboard.figures.expected'), formatPrice(t, stats.today.expectedRevenue, currency))}
      {cell(
        t('dashboard.figures.occupancy'),
        `${occupancy}%`,
        <span className="mt-1 block h-1.5 overflow-hidden rounded-pill bg-ink-100" aria-hidden="true">
          <span className="block h-full rounded-pill bg-orchid-400" style={{ width: `${occupancy}%` }} />
        </span>,
      )}
      {cell(
        t('dashboard.figures.week'),
        formatPrice(t, stats.week.completedRevenue, currency),
        t('dashboard.figures.weekExpected', { amount: formatPrice(t, stats.week.expectedRevenue, currency) }),
      )}
      {cell(t('dashboard.figures.next7'), stats.next7Days)}
      {cell(t('dashboard.figures.newClients'), stats.newClientsThisMonth)}
    </dl>
  );
}

function TopServices({ stats }: { stats: DashboardStats }) {
  const { t } = useTranslation('admin');
  const pick = useI18nText();
  const max = Math.max(1, ...stats.topServices.map((s) => s.count));
  if (stats.topServices.length === 0) {
    return <p className="rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">{t('dashboard.top.empty')}</p>;
  }
  return (
    <ol className="flex flex-col gap-3.5 rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
      {stats.topServices.map((service) => (
        <li key={service.id}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 font-semibold">{pick(service.name)}</span>
            <span className="tabular shrink-0 text-ink-600">{t('dashboard.top.count', { count: service.count })}</span>
          </div>
          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-pill bg-ink-100" aria-hidden="true">
            <span className="block h-full rounded-pill bg-orchid-400" style={{ width: `${(service.count / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}
