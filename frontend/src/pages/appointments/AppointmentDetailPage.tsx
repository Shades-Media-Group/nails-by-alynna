import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { NailArt } from '@/components/brand/NailArt';
import { Alert } from '@/components/common/Alert';
import { ContactSheet } from '@/components/common/ContactSheet';
import { AddToCalendarSheet } from '@/components/appointments/AddToCalendar';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoyaltyLine } from '@/components/loyalty/LoyaltyBits';
import { Button, ButtonLink, EmptyState, Sheet, Skeleton, Textarea, toast } from '@/components/ui';
import { CalendarAddIcon, ChatIcon, DirectionsIcon, EventBusyIcon, HourglassIcon, ReplayIcon, ScheduleIcon } from '@/components/ui/icons';
import { useCatalog, useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { rebookQuery } from '@/lib/appointment';
import { cx } from '@/lib/cx';
import { dayParts, formatDateTime, formatDuration, formatPrice, formatTime, zonedDate } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { SWATCH } from '@/lib/swatch';
import { appointmentsApi } from '@/services/api/endpoints';
import { queries } from '@/services/queries';

/** One booking: when and what, the rules for changing it, and the actions that are allowed now. */
export default function AppointmentDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation(['account', 'booking', 'common']);
  const { lp, locale } = useLocale();
  const pick = useI18nText();
  const catalog = useCatalog();
  const { timeZone, currency, data: config } = useStudio();
  const queryClient = useQueryClient();
  const appointment = useQuery(queries.appointment(id));
  const [cancelOpen, setCancelOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reason, setReason] = useState('');
  // Read the clock once per visit to this screen, not on every render.
  const [now] = useState(() => Date.now());

  const cancel = useMutation({
    mutationFn: () => appointmentsApi.cancel(id, reason.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(queries.appointment(id).queryKey, updated);
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['availability-days'] });
      setCancelOpen(false);
      toast.success(t('booking.cancelled'));
    },
  });

  if (appointment.isPending) {
    return (
      <div className="gutter-x flex flex-col gap-3 pt-[calc(var(--safe-top)+4.5rem)] lg:px-0 lg:pt-24">
        <Skeleton rounded="xl" className="h-40" />
        <Skeleton rounded="xl" className="h-32" />
      </div>
    );
  }
  if (appointment.isError) {
    return (
      <>
        <PageHeader back backTo={lp('/bookings')} title={t('booking.title')} />
        <EmptyState
          icon={EventBusyIcon}
          tone="peach"
          title={t('booking.notFound')}
          action={
            <ButtonLink to={lp('/bookings')} size="md" variant="soft">
              {t('booking.toBookings')}
            </ButtonLink>
          }
        />
      </>
    );
  }

  const a = appointment.data;
  const date = zonedDate(new Date(a.start), timeZone);
  const leaf = dayParts(date, locale);
  const active = a.status === 'pending' || a.status === 'confirmed';
  const upcoming = active && new Date(a.end).getTime() > now;

  return (
    <div className="pb-8">
      <PageHeader back backTo={lp('/bookings')} title={t('booking.title')} />

      <div className="gutter-x mt-4 flex flex-col gap-4 lg:px-0">
        <section className={cx('rounded-2xl p-4', active ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-900')}>
          <div className="flex items-start gap-4">
            <span className={cx('flex w-14 shrink-0 flex-col items-center rounded-xl pb-2 pt-1.5', active ? 'bg-white text-ink-900' : 'bg-white text-ink-500')}>
              <span className="text-xs font-semibold capitalize text-rose-600">{leaf.month}</span>
              <span className="tabular text-[1.625rem] font-extrabold leading-none tracking-[-0.03em]">{leaf.day}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[1.0625rem] font-bold first-letter:uppercase">{formatDateTime(a.start, locale, timeZone)}</p>
              <p className={cx('mt-0.5 flex items-center gap-1.5 text-sm', active ? 'text-white/65' : 'text-ink-600')}>
                <ScheduleIcon fontSize="inherit" />
                {formatTime(a.start, locale, timeZone)} · {formatDuration(t, a.durationMin)}
                {a.staff ? ` · ${t('booking:flow.withMaster', { name: a.staff.name })}` : ''}
              </p>
            </div>
          </div>
          {a.status === 'pending' ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-white/8 px-3 py-2 text-sm text-peach-200">
              <HourglassIcon fontSize="inherit" className="shrink-0" />
              {t('bookings.waiting')}
            </p>
          ) : a.status === 'cancelled' ? (
            <p className="mt-3 text-sm font-semibold text-red-700">
              {a.cancelledBy ? t(`booking.cancelledBy_${a.cancelledBy}`) : t('common:status.cancelled')}
            </p>
          ) : a.status === 'no_show' ? (
            <p className="mt-3 text-sm font-semibold text-red-700">{t('booking.noShow')}</p>
          ) : null}
          {upcoming ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                className="press inline-flex h-9 items-center gap-1.5 rounded-pill bg-white/10 px-3.5 text-sm font-semibold hover:bg-white/18"
              >
                <CalendarAddIcon fontSize="inherit" className="text-base" />
                {t('booking:flow.addToCalendar')}
              </button>
              {config?.studio.mapsUrl ? (
                <a
                  href={config.studio.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press inline-flex h-9 items-center gap-1.5 rounded-pill bg-white/10 px-3.5 text-sm font-semibold hover:bg-white/18"
                >
                  <DirectionsIcon fontSize="inherit" className="text-base" />
                  {t('common:contact.directions')}
                </a>
              ) : null}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="services-title" className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
          <h2 id="services-title" className="sr-only">
            {t('booking.services')}
          </h2>
          <ul className="divide-y divide-ink-100">
            {a.services.map((line) => {
              const service = catalog.byId.get(line.id);
              const color = (service && catalog.categoryById.get(service.categoryId)?.color) || 'blush';
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
            <span className="font-bold">{t('booking.total')}</span>
            <span className="tabular text-lg font-extrabold">{formatPrice(t, a.totalPrice, currency, a.priceFrom)}</span>
          </div>
          <LoyaltyLine loyalty={a.loyalty} currency={currency} />
        </section>

        {a.notes ? (
          <section className="rounded-2xl bg-ink-50 p-4">
            <h2 className="text-sm font-semibold text-ink-600">{t('booking.notes')}</h2>
            <p className="mt-1 whitespace-pre-line text-[0.9375rem]">{a.notes}</p>
          </section>
        ) : null}

        {upcoming ? (
          a.canChange ? (
            <section className="flex flex-col gap-3">
              <p className="text-sm text-ink-600">{t('booking.freeUntil', { date: formatDateTime(a.changeDeadline, locale, timeZone) })}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ButtonLink to={`${lp('/book')}?reschedule=${a.id}`} variant="soft" size="md" icon={ScheduleIcon} fullWidth>
                  {t('booking.reschedule')}
                </ButtonLink>
                <Button variant="outline" size="md" fullWidth onClick={() => setCancelOpen(true)} className="text-red-700">
                  {t('booking.cancel')}
                </Button>
              </div>
            </section>
          ) : (
            <section className="flex flex-col gap-3">
              <Alert tone="info">{t('booking.tooLate')}</Alert>
              <Button variant="soft" size="md" icon={ChatIcon} onClick={() => setContactOpen(true)}>
                {t('booking.contactStudio')}
              </Button>
            </section>
          )
        ) : (
          <ButtonLink to={`${lp('/book')}${rebookQuery(a)}`} size="md" icon={ReplayIcon}>
            {t('bookings.bookAgain')}
          </ButtonLink>
        )}

        <p className="text-center text-xs text-ink-500">
          {t('booking.code')}: <span className="tabular font-semibold tracking-wide text-ink-700">{a.code}</span>
        </p>
      </div>

      <Sheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('booking.cancelTitle')}
        description={t('booking.cancelText')}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="soft" size="md" onClick={() => setCancelOpen(false)}>
              {t('booking.keep')}
            </Button>
            <Button variant="danger" size="md" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('booking.cancelConfirm')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 py-2">
          <Textarea
            label={t('booking.cancelReason')}
            placeholder={t('booking.cancelReasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={3}
          />
          {cancel.isError ? <Alert>{errorMessage(t, cancel.error)}</Alert> : null}
        </div>
      </Sheet>
      <ContactSheet open={contactOpen} onClose={() => setContactOpen(false)} />
      {a ? <AddToCalendarSheet appointment={a} open={calendarOpen} onClose={() => setCalendarOpen(false)} /> : null}
    </div>
  );
}
