import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/app/auth';
import { ConfirmStep } from '@/components/booking/ConfirmStep';
import { DoneStep } from '@/components/booking/DoneStep';
import { MasterStep } from '@/components/booking/MasterStep';
import { SelectionBar } from '@/components/booking/SelectionBar';
import { ServiceList } from '@/components/booking/ServiceList';
import { StepProgress } from '@/components/booking/StepProgress';
import { TimeStep } from '@/components/booking/TimeStep';
import { IconButton, Skeleton, toast } from '@/components/ui';
import { ArrowBackIcon, CloseIcon } from '@/components/ui/icons';
import { useEligibleMasters } from '@/hooks/useEligibleMasters';
import { useCatalog, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { formatDayLong, formatTime } from '@/lib/format';
import { toggleService } from '@/lib/selection';
import { normalizePhone } from '@/lib/validation';
import { ApiError } from '@/services/api/client';
import { appointmentsApi } from '@/services/api/endpoints';
import { queries } from '@/services/queries';
import type { Appointment, Service, Slot } from '@/types/api';

type Step = 'services' | 'master' | 'time' | 'confirm';

/**
 * The booking flow: services → master (only when there is more than one) → time → confirm.
 * Each step is a history entry (?step=…), so the phone's back gesture walks back through the
 * flow. With ?reschedule=<id> the same screens move an existing booking.
 */
export default function BookingPage() {
  const { t } = useTranslation(['booking', 'common']);
  const { lp, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, setUser } = useAuth();
  const catalog = useCatalog();
  const { data: config, timeZone, currency } = useStudio();
  const [params, setParams] = useSearchParams();

  const rescheduleId = params.get('reschedule');
  const original = useQuery({ ...queries.appointment(rescheduleId ?? ''), enabled: Boolean(rescheduleId) });

  const selectedFromUrl = (params.get('services') ?? '').split(',').filter((id) => catalog.byId.has(id));
  const serviceIds = rescheduleId ? (original.data?.services.map((s) => s.id) ?? []) : selectedFromUrl;
  const services = serviceIds.map((id) => catalog.byId.get(id)).filter((s): s is Service => Boolean(s));

  const { eligible } = useEligibleMasters(serviceIds);
  const showMasters = !rescheduleId && (config?.booking.mastersCount ?? 1) > 1 && eligible.length > 1;
  const steps: Step[] = rescheduleId ? ['time', 'confirm'] : ['services', ...(showMasters ? (['master'] as const) : []), 'time', 'confirm'];

  const [staffId, setStaffId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notes, setNotes] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [done, setDone] = useState<Appointment | null>(null);

  // Where we are: the URL step when it makes sense, otherwise the first step still missing.
  const requested = params.get('step') as Step | null;
  let step: Step = requested && steps.includes(requested) ? requested : serviceIds.length > 0 ? (steps[1] ?? 'time') : steps[0]!;
  if (!rescheduleId && serviceIds.length === 0 && catalog.isSuccess) step = 'services';
  if (step === 'confirm' && !slot) step = 'time';
  const stepIndex = steps.indexOf(step);
  const effectiveStaff = rescheduleId ? (original.data?.staff?.id ?? null) : staffId;

  const go = useCallback(
    (next: Step, replace = false) => {
      const nextParams = new URLSearchParams(params);
      nextParams.set('step', next);
      // A new step starts at the top (the router's scroll restoration does it).
      setParams(nextParams, { replace });
    },
    [params, setParams],
  );

  const setServices = (ids: string[]) => {
    const nextParams = new URLSearchParams(params);
    if (ids.length > 0) nextParams.set('services', ids.join(','));
    else nextParams.delete('services');
    // Picking services keeps you on this step until you press Continue.
    nextParams.set('step', 'services');
    setParams(nextParams, { replace: true, preventScrollReset: true });
    setSlot(null);
    setDate(null);
  };

  const leave = () => (window.history.length > 1 ? navigate(-1) : navigate(lp('/home'), { replace: true }));
  const back = () => (stepIndex > 0 ? go(steps[stepIndex - 1]!, true) : leave());

  const needsPhone = !rescheduleId && !user?.phone;
  const normalizedPhone = normalizePhone(phone);
  const phoneError = needsPhone && phoneTouched && !normalizedPhone ? t('common:validation.invalid_phone') : undefined;

  const submit = useMutation({
    mutationFn: () =>
      rescheduleId
        ? appointmentsApi.reschedule(rescheduleId, slot!.start, effectiveStaff)
        : appointmentsApi.create({
            serviceIds,
            staffId,
            start: slot!.start,
            notes: notes.trim(),
            ...(needsPhone && normalizedPhone ? { phone: normalizedPhone } : {}),
          }),
    onSuccess: (appointment) => {
      if (needsPhone && user && normalizedPhone) setUser({ ...user, phone: normalizedPhone });
      queryClient.setQueryData(queries.appointment(appointment.id).queryKey, appointment);
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['availability-days'] });
      setDone(appointment);
      window.scrollTo({ top: 0 });
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.code === 'SLOT_TAKEN' || error.code === 'SLOT_UNAVAILABLE')) {
        toast.error(t('flow.slotTakenToast'));
        setSlot(null);
        void queryClient.invalidateQueries({ queryKey: ['availability-slots'] });
        void queryClient.invalidateQueries({ queryKey: ['availability-days'] });
        go('time', true);
      }
    },
  });

  const onSubmit = () => {
    setPhoneTouched(true);
    if (needsPhone && !normalizedPhone) return;
    submit.mutate();
  };

  if (done) {
    return (
      <main className="gutter-x mx-auto min-h-dvh max-w-xl pb-[calc(var(--safe-bottom)+2rem)] pt-[calc(var(--safe-top)+1.5rem)] animate-page">
        <DoneStep appointment={done} rescheduled={Boolean(rescheduleId)} />
      </main>
    );
  }

  const durationMin = services.reduce((sum, s) => sum + s.durationMin, 0);
  const price = services.reduce((sum, s) => sum + s.price, 0);
  const priceFrom = services.some((s) => s.priceFrom);
  const stepLabel: Record<Step, string> = {
    services: t('flow.stepServices'),
    master: t('flow.stepMaster'),
    time: t('flow.stepTime'),
    confirm: t('flow.stepConfirm'),
  };
  const heading: Record<Step, { title: string; text?: string }> = {
    services: { title: t('flow.chooseServices'), text: t('flow.chooseServicesText') },
    master: { title: t('flow.chooseMaster') },
    time: { title: t('flow.chooseTime'), text: t('flow.chooseTimeText') },
    confirm: { title: t('flow.confirmTitle') },
  };
  const masterName =
    effectiveStaff !== null
      ? (eligible.find((m) => m.id === effectiveStaff)?.name ?? original.data?.staff?.name ?? null)
      : eligible.length === 1
        ? eligible[0]!.name
        : null;
  const loading = catalog.isPending || (rescheduleId !== null && original.isPending);
  const bar = step === 'services' ? services.length > 0 : step === 'time' ? Boolean(slot) : false;

  return (
    <main className={bar ? 'pb-36' : 'pb-[calc(var(--safe-bottom)+2rem)]'}>
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-white pt-[var(--safe-top)]">
        <div className="gutter-x mx-auto flex h-14 max-w-2xl items-center gap-3">
          <IconButton icon={stepIndex > 0 ? ArrowBackIcon : CloseIcon} label={stepIndex > 0 ? t('common:actions.back') : t('flow.leave')} size="sm" variant="soft" onClick={back} />
          <p className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold">{rescheduleId ? t('flow.rescheduleTitle') : t('flow.title')}</p>
        </div>
        <div className="gutter-x mx-auto max-w-2xl pb-3">
          <StepProgress steps={steps.map((s) => stepLabel[s])} current={Math.max(stepIndex, 0)} />
        </div>
      </header>

      <div key={step} className="gutter-x mx-auto max-w-2xl pt-5 animate-page">
        <h1 className="text-h1 font-extrabold">{heading[step].title}</h1>
        {heading[step].text ? <p className="mt-1.5 text-[0.9375rem] text-ink-600">{heading[step].text}</p> : null}

        <div className="mt-5">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} rounded="xl" className="h-24" />
              ))}
            </div>
          ) : step === 'services' ? (
            <div className="-mx-3">
              <ServiceList selected={serviceIds} onToggle={(service) => setServices(toggleService(serviceIds, service, catalog))} />
            </div>
          ) : step === 'master' ? (
            <MasterStep
              serviceIds={serviceIds}
              selected={staffId}
              onSelect={(id) => {
                setStaffId(id);
                setSlot(null);
                setDate(null);
                go('time');
              }}
            />
          ) : step === 'time' ? (
            <TimeStep
              serviceIds={serviceIds}
              staffId={effectiveStaff}
              date={date}
              onDate={(value) => {
                setDate(value);
                setSlot(null);
              }}
              slot={slot}
              onSlot={setSlot}
            />
          ) : slot ? (
            <ConfirmStep
              mode={rescheduleId ? 'reschedule' : 'new'}
              services={services}
              slot={slot}
              masterName={masterName}
              needsPhone={needsPhone}
              phone={phone}
              onPhone={setPhone}
              phoneError={phoneError}
              notes={notes}
              onNotes={setNotes}
              submitting={submit.isPending}
              error={submit.isError && !(submit.error instanceof ApiError && submit.error.code.startsWith('SLOT_')) ? errorMessage(t, submit.error) : null}
              onEdit={(target) => go(target === 'services' ? 'services' : 'time', true)}
              onSubmit={onSubmit}
            />
          ) : null}
        </div>
      </div>

      {step === 'services' && services.length > 0 ? (
        <SelectionBar
          count={services.length}
          durationMin={durationMin}
          price={price}
          priceFrom={priceFrom}
          currency={currency}
          actionLabel={t('services.continue')}
          onAction={() => go(steps[1] ?? 'time')}
        />
      ) : null}
      {step === 'time' && slot ? (
        <SelectionBar
          count={services.length}
          durationMin={durationMin}
          price={price}
          priceFrom={priceFrom}
          currency={currency}
          detail={
            <span className="first-letter:uppercase">
              {formatDayLong(slot.start, locale, timeZone)}, {formatTime(slot.start, locale, timeZone)}
            </span>
          }
          actionLabel={t('services.continue')}
          onAction={() => go('confirm')}
        />
      ) : null}
    </main>
  );
}
