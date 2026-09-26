import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { StepProgress } from '@/components/booking/StepProgress';
import { Alert } from '@/components/common/Alert';
import { PromoCodeField } from '@/components/promo/PromoCodeField';
import { Button, ButtonLink, IconButton, SegmentedControl, Textarea, toast } from '@/components/ui';
import { AddIcon, ArrowBackIcon, ArrowForwardIcon, QrCodeIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { formatDateTime, formatDuration, formatPrice, formatTime, fullName } from '@/lib/format';
import { promoAmountText, promoProblemText, promoRefusal } from '@/lib/promo';
import { scrollPageTo } from '@/lib/scroll';
import { isApiError } from '@/services/api/client';
import type { PromoQuote, StaffAppointment } from '@/types/api';
import { adminApi, adminQueries, type ClientDetail, type NewAppointmentInput } from '../api';
import { AdminHeader } from '../components/AdminHeader';
import { ClientPicker, type PickedClient } from '../components/ClientPicker';
import { useBookableCatalog, useRefreshBookings } from '../components/hooks';
import { InviteSheet } from '../components/InviteSheet';
import { MasterPicker } from '../components/MasterPicker';
import { ServicePicker } from '../components/ServicePicker';
import { SlotPicker, type TimeChoice } from '../components/SlotPicker';
import { SuccessMark } from '../components/SuccessMark';
import { isDate } from '../components/time';
import { clientFieldIssues, eligibleMasters } from '../components/utils';
import { useDeskPromoQuote } from '../promo/useDeskPromoQuote';

type StepKey = 'client' | 'services' | 'master' | 'time' | 'details';

interface Created {
  appointment: StaffAppointment;
  hasAccount: boolean;
}

const fromDetail = (detail: ClientDetail): PickedClient => ({
  kind: 'existing',
  id: detail.client.id,
  name: detail.client.name,
  surname: detail.client.surname,
  phone: detail.client.phone,
  email: detail.client.email,
  hasAccount: detail.client.hasAccount,
  bookingBlocked: detail.client.bookingBlocked,
});

/**
 * A booking made by the studio: client (found or added on the spot), services, master, time
 * and a note. Phones go one step at a time; computers see the whole form with a summary.
 * Walk-ins without the app get a QR invite right after.
 */
export default function NewAppointmentPage() {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { lp, locale } = useLocale();
  const { currency } = useStudio();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const refresh = useRefreshBookings();
  const catalog = useBookableCatalog();
  const staff = useQuery(adminQueries.staff());

  const prefillId = params.get('clientId');
  const rawDate = params.get('date');
  const prefillDate = isDate(rawDate) ? rawDate : undefined;
  const prefill = useQuery({ ...adminQueries.client(prefillId ?? ''), enabled: Boolean(prefillId) });

  const [picked, setPicked] = useState<{ value: PickedClient | null } | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [time, setTime] = useState<TimeChoice | null>(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'confirmed' | 'pending'>('confirmed');
  const [stepKey, setStepKey] = useState<StepKey>('client');
  const [checked, setChecked] = useState<Partial<Record<StepKey, boolean>>>({});
  const [created, setCreated] = useState<Created | null>(null);
  const [inviting, setInviting] = useState(false);
  const [promoCode, setPromoCode] = useState<string | null>(null);

  const client = picked ? picked.value : prefill.data ? fromDetail(prefill.data) : null;
  // "Any master" with a free time books the master who is actually free then.
  const bookedStaffId = staffId ?? (time && !time.custom ? (time.staffIds[0] ?? null) : null);
  const promo = useDeskPromoQuote({
    code: promoCode,
    serviceIds,
    staffId: bookedStaffId,
    start: time?.start ?? null,
    clientId: client?.kind === 'existing' ? client.id : null,
  });
  const masters = eligibleMasters(staff.data, serviceIds);
  const teamSize = (staff.data ?? []).filter((m) => m.isActive && m.isBookable).length;

  const steps: Array<{ key: StepKey; title: string }> = [
    { key: 'client', title: t('booking.steps.client') },
    { key: 'services', title: t('booking.steps.services') },
    ...(teamSize > 1 ? [{ key: 'master' as const, title: t('booking.steps.master') }] : []),
    { key: 'time', title: t('booking.steps.time') },
    { key: 'details', title: t('booking.steps.details') },
  ];
  // Steps are tracked by name: the master step appears only once the team has loaded.
  const step = Math.max(0, steps.findIndex((s) => s.key === stepKey));
  const current = steps[step]!;

  const valid: Record<StepKey, boolean> = {
    client: client !== null && (client.kind === 'existing' || Object.keys(clientFieldIssues(client)).length === 0),
    services: serviceIds.length > 0,
    master: true,
    time: time !== null,
    details: true,
  };

  const create = useMutation({
    mutationFn: (input: NewAppointmentInput) => adminApi.createAppointment(input),
    onSuccess: (appointment) => {
      refresh(appointment.client.id);
      toast.success(appointment.status === 'pending' ? t('booking.createdRequest') : t('booking.created'));
      const hasAccount = client?.kind === 'existing' ? client.hasAccount : false;
      setCreated({ appointment, hasAccount });
      setInviting(!hasAccount);
      scrollPageTo(0);
    },
  });
  const server = fieldErrors(t, create.error);

  const chooseServices = (ids: string[]) => {
    setServiceIds(ids);
    // A free time was free for these services and this master only.
    if (time && !time.custom) setTime(null);
    if (staffId && !eligibleMasters(staff.data, ids).some((m) => m.id === staffId)) setStaffId(null);
  };
  const chooseMaster = (id: string | null) => {
    setStaffId(id);
    if (time && !time.custom) setTime(null);
  };

  const goTo = (index: number) => {
    setStepKey(steps[index]?.key ?? 'client');
    scrollPageTo(0);
  };
  const next = () => {
    if (!valid[current.key]) {
      setChecked((c) => ({ ...c, [current.key]: true }));
      return;
    }
    goTo(step + 1);
  };
  const submit = () => {
    const firstInvalid = steps.findIndex((s) => !valid[s.key]);
    if (firstInvalid !== -1 || !client || !time) {
      setChecked({ client: true, services: true, time: true });
      if (firstInvalid !== -1) setStepKey(steps[firstInvalid]!.key);
      return;
    }
    const email = client.kind === 'new' ? client.email.trim() : '';
    create.mutate({
      ...(client.kind === 'existing'
        ? { clientId: client.id }
        : { newClient: { name: client.name.trim(), surname: client.surname.trim(), phone: client.phone.trim(), ...(email ? { email } : {}) } }),
      serviceIds,
      // "Any master" with a free time: book the master who is actually free then.
      staffId: staffId ?? (time.custom ? null : (time.staffIds[0] ?? null)),
      start: time.start,
      notes: notes.trim(),
      status,
      force: time.force,
      ...(promo.quote ? { promoCode: promo.quote.code } : {}),
    });
  };
  const restart = () => {
    setPicked({ value: null });
    setServiceIds([]);
    setStaffId(null);
    setTime(null);
    setNotes('');
    setStatus('confirmed');
    setStepKey('client');
    setChecked({});
    setCreated(null);
    setPromoCode(null);
    create.reset();
    if (prefillId || prefillDate) navigate(lp('/admin/appointments/new'), { replace: true });
    scrollPageTo(0);
  };

  if (created) {
    return <Done created={created} inviting={inviting} setInviting={setInviting} onRestart={restart} />;
  }

  const section = (key: StepKey, title: string, body: ReactNode) => {
    const index = steps.findIndex((s) => s.key === key);
    if (index === -1) return null;
    return (
      <section key={key} aria-labelledby={`step-${key}`} className={cx('flex flex-col gap-4', index !== step && 'hidden lg:flex')}>
        <h2 id={`step-${key}`} className="text-h2 font-extrabold">
          {title}
        </h2>
        {body}
      </section>
    );
  };

  const refusal = promoRefusal(create.error);
  const submitError = create.isError ? (
    <Alert>
      {server['newClient.email']
        ? t('booking.emailTaken')
        : refusal
          ? promoProblemText(t, refusal, { locale, currency, desk: true })
          : errorMessage(t, create.error)}
      {isApiError(create.error, 'SLOT_TAKEN') ? <span className="mt-1 block">{t('booking.overlapHint')}</span> : null}
    </Alert>
  ) : null;

  return (
    <div className="pb-8">
      <AdminHeader title={t('booking.title')} subtitle={t('booking.subtitle')} />

      <div className="gutter-x mt-4 lg:hidden">
        <StepProgress steps={steps.map((s) => s.title)} current={step} />
      </div>

      <div className="gutter-x mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-0">
        <div className="flex min-w-0 flex-col gap-10">
          {section(
            'client',
            t('booking.whoFor'),
            <>
              <ClientPicker
                value={client}
                onChange={(value) => setPicked({ value })}
                showErrors={Boolean(checked.client) && !valid.client}
              />
              {server['newClient.email'] ? <Alert>{t('booking.emailTaken')}</Alert> : null}
              {client?.kind === 'existing' && client.bookingBlocked ? <Alert tone="info">{t('booking.blockedNote')}</Alert> : null}
              {prefill.isError ? <Alert>{errorMessage(t, prefill.error)}</Alert> : null}
            </>,
          )}
          {section(
            'services',
            t('booking.whatServices'),
            <>
              <ServicePicker selected={serviceIds} onChange={chooseServices} />
              {checked.services && !valid.services ? (
                <p className="text-sm font-semibold text-red-700" role="alert">
                  {t('booking.pickServices')}
                </p>
              ) : null}
            </>,
          )}
          {section(
            'master',
            t('booking.whichMaster'),
            staff.isError ? (
              <Alert>{errorMessage(t, staff.error)}</Alert>
            ) : (
              <MasterPicker masters={masters} value={staffId} onChange={chooseMaster} anyLabel={t('booking.anyMaster')} anyText={t('booking.anyMasterText')} />
            ),
          )}
          {section(
            'time',
            t('booking.whenTitle'),
            <>
              <SlotPicker serviceIds={serviceIds} staffId={staffId} value={time} onChange={setTime} initialDate={prefillDate} />
              {checked.time && !valid.time ? (
                <p className="text-sm font-semibold text-red-700" role="alert">
                  {t('booking.pickTime')}
                </p>
              ) : null}
            </>,
          )}
          {section(
            'details',
            t('booking.detailsTitle'),
            <>
              <div className="flex flex-col gap-2">
                <SegmentedControl
                  label={t('booking.status')}
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: 'confirmed', label: t('booking.confirmed') },
                    { value: 'pending', label: t('booking.pendingShort') },
                  ]}
                  className="w-full sm:w-auto"
                />
                <p className="text-sm text-ink-600">{status === 'confirmed' ? t('booking.confirmedHint') : t('booking.pendingHint')}</p>
              </div>
              <div className="flex flex-col gap-1">
                <PromoCodeField state={promo} onCode={setPromoCode} desk />
                {promoCode && !promo.quote && (!time || serviceIds.length === 0) ? (
                  <p className="text-sm text-ink-600">{t('promo:admin.desk.checkFirst')}</p>
                ) : null}
              </div>
              <Textarea
                label={`${t('booking.notes')} (${t('common.optional')})`}
                hint={t('booking.notesHint')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
              />
              <div className="lg:hidden">
                <Summary client={client} serviceIds={serviceIds} staffId={staffId} time={time} catalog={catalog} teamSize={teamSize} promo={promo.quote} onRemovePromo={() => setPromoCode(null)} />
              </div>
              <div className="lg:hidden">{submitError}</div>
            </>,
          )}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-8 flex flex-col gap-3">
            <Summary client={client} serviceIds={serviceIds} staffId={staffId} time={time} catalog={catalog} teamSize={teamSize} promo={promo.quote} onRemovePromo={() => setPromoCode(null)} />
            {submitError}
            <Button size="lg" fullWidth loading={create.isPending} onClick={submit}>
              {t('booking.create')}
            </Button>
          </div>
        </aside>
      </div>

      {/* Phones: back / continue, above the tab bar. */}
      <div className="gutter-x sticky bottom-[calc(var(--safe-bottom)+4.75rem)] z-20 mt-8 lg:hidden">
        <div className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-float ring-1 ring-inset ring-ink-100">
          {step > 0 ? <IconButton icon={ArrowBackIcon} label={t('common.back')} variant="soft" onClick={() => goTo(step - 1)} /> : null}
          <p className="min-w-0 flex-1 px-1 text-sm text-ink-600">
            <SelectionLine client={client} serviceIds={serviceIds} catalog={catalog} />
          </p>
          {current.key === 'details' ? (
            <Button size="md" loading={create.isPending} onClick={submit}>
              {t('booking.createShort')}
            </Button>
          ) : (
            <Button size="md" trailingIcon={ArrowForwardIcon} onClick={next}>
              {t('booking.continue')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type Catalog = ReturnType<typeof useBookableCatalog>;

/** "2 services · 1 h 30 min · 450 MDL" for the phone action bar (or who it is for, before that). */
function SelectionLine({ client, serviceIds, catalog }: { client: PickedClient | null; serviceIds: string[]; catalog: Catalog }) {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { currency } = useStudio();
  const chosen = serviceIds.map((id) => catalog.byId.get(id)).filter((s) => s !== undefined);
  if (chosen.length === 0) {
    const name = client ? fullName({ name: client.name.trim(), surname: client.surname.trim() }) : '';
    return name ? (
      <>
        <span className="block break-words font-semibold text-ink-900">{name}</span>
        <span className="block">{t('booking.nothingYet')}</span>
      </>
    ) : (
      <>{t('booking.nothingYet')}</>
    );
  }
  const minutes = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const price = chosen.reduce((sum, s) => sum + s.price, 0);
  return (
    <>
      <span className="block font-semibold text-ink-900">{t('booking:services.summary', { count: chosen.length })}</span>
      <span className="tabular block">
        {formatDuration(t, minutes)} · {formatPrice(t, price, currency, chosen.some((s) => s.priceFrom))}
      </span>
    </>
  );
}

function Summary({
  client,
  serviceIds,
  staffId,
  time,
  catalog,
  teamSize,
  promo,
  onRemovePromo,
}: {
  client: PickedClient | null;
  serviceIds: string[];
  staffId: string | null;
  time: TimeChoice | null;
  catalog: Catalog;
  teamSize: number;
  /** A promo code checked for this booking: its discount and what is left to pay. */
  promo?: PromoQuote | null;
  onRemovePromo?: () => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'booking', 'promo']);
  const { locale } = useLocale();
  const { timeZone, currency } = useStudio();
  const staff = useQuery(adminQueries.staff());
  const name = (text: { ro: string; ru: string; en: string }) => text[locale] || text.ro;
  const chosen = serviceIds.map((id) => catalog.byId.get(id)).filter((s) => s !== undefined);
  const minutes = chosen.reduce((sum, s) => sum + s.durationMin, 0);
  const price = chosen.reduce((sum, s) => sum + s.price, 0);
  const master = staffId ? staff.data?.find((m) => m.id === staffId) : null;
  const end = time ? new Date(new Date(time.start).getTime() + minutes * 60_000) : null;
  const clientName = client && (client.name.trim() || client.surname.trim()) ? fullName({ name: client.name.trim(), surname: client.surname.trim() }) : null;

  const row = (label: string, value: ReactNode, empty: boolean) => (
    <div className="flex flex-col gap-0.5 py-3">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className={cx('text-[0.9375rem]', empty ? 'text-ink-500' : 'font-semibold text-ink-900')}>{value}</dd>
    </div>
  );

  return (
    <section aria-label={t('booking.summary')} className="rounded-2xl bg-white p-4 ring-1 ring-inset ring-ink-100">
      <h2 className="text-h3 font-extrabold">{t('booking.summary')}</h2>
      <dl className="mt-1 flex flex-col divide-y divide-ink-100">
        {row(t('booking.client'), clientName ? `${clientName}${client?.kind === 'new' ? ` · ${t('booking.newClientShort')}` : ''}` : t('booking.notChosen'), !clientName)}
        {row(
          t('booking.services'),
          chosen.length ? (
            <ul className="flex flex-col gap-1">
              {chosen.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">{name(s.name)}</span>
                  <span className="tabular shrink-0 font-normal text-ink-700">{formatPrice(t, s.price, currency, s.priceFrom)}</span>
                </li>
              ))}
            </ul>
          ) : (
            t('booking.notChosen')
          ),
          chosen.length === 0,
        )}
        {teamSize > 1 ? row(t('booking.master'), master ? master.name : t('booking.anyMaster'), false) : null}
        {row(
          t('booking.when'),
          time && end ? (
            <>
              <span className="block first-letter:uppercase">{formatDateTime(time.start, locale, timeZone)}</span>
              <span className="tabular block font-normal text-ink-700">
                {t('booking.until', { time: formatTime(end, locale, timeZone) })}
                {time.force ? ` · ${t('booking.overlapAllowed')}` : ''}
              </span>
            </>
          ) : (
            t('booking.notChosen')
          ),
          !time,
        )}
      </dl>
      <div className="mt-1 flex items-baseline justify-between border-t border-ink-100 pt-3">
        <span className="font-bold">{t('appointment.total')}</span>
        <span className="tabular text-right">
          <span className="block text-lg font-extrabold">{formatPrice(t, price, currency, chosen.some((s) => s.priceFrom))}</span>
          {minutes > 0 ? <span className="block text-sm text-ink-600">{formatDuration(t, minutes)}</span> : null}
        </span>
      </div>
      {promo ? (
        <div className="mt-3 flex flex-col gap-1 border-t border-ink-100 pt-3">
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words font-semibold">{t('promo:line.title', { code: promo.code })}</span>
            <span className="tabular shrink-0 font-bold text-rose-700">{promoAmountText(t, promo, currency)}</span>
          </p>
          <p className="flex items-baseline justify-between gap-3">
            <span className="font-bold">{t('promo:line.toPay')}</span>
            <span className="tabular text-lg font-extrabold">
              {formatPrice(t, Math.max(0, price - promo.discount), currency, chosen.some((s) => s.priceFrom))}
            </span>
          </p>
          {onRemovePromo ? (
            <button
              type="button"
              onClick={onRemovePromo}
              aria-label={t('promo:field.removeCode', { code: promo.code })}
              className="-ml-2 inline-flex min-h-9 items-center self-start rounded-pill px-2 text-sm font-semibold text-rose-700 underline-offset-4 hover:underline"
            >
              {t('promo:field.remove')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** After saving: what was booked, the invite for walk-ins, and where to go next. */
function Done({
  created,
  inviting,
  setInviting,
  onRestart,
}: {
  created: Created;
  inviting: boolean;
  setInviting: (open: boolean) => void;
  onRestart: () => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'booking']);
  const { lp, locale } = useLocale();
  const { timeZone } = useStudio();
  const a = created.appointment;
  const pending = a.status === 'pending';
  // Focus the result once, so screen readers announce it; later renders leave focus alone.
  const focusOnce = useCallback((el: HTMLHeadingElement | null) => el?.focus({ preventScroll: true }), []);
  return (
    <div className="gutter-x flex flex-col items-center pb-8 pt-[calc(var(--safe-top)+2rem)] text-center lg:px-0 lg:pt-16">
      <SuccessMark pending={pending} />
      <h1 className="mt-5 text-h1 font-extrabold outline-none" tabIndex={-1} ref={focusOnce}>
        {pending ? t('booking.doneRequestTitle') : t('booking.doneTitle')}
      </h1>
      <p className="mt-2 max-w-sm text-ink-600">{t('booking.doneText', { name: fullName(a.client) })}</p>

      <div className="mt-6 w-full max-w-sm rounded-2xl bg-ink-50 p-4 text-left">
        <p className="font-bold first-letter:uppercase">{formatDateTime(a.start, locale, timeZone)}</p>
        <p className="mt-0.5 text-sm text-ink-600">
          {fullName(a.client)}
          {a.staff ? ` · ${a.staff.name}` : ''}
        </p>
        <p className="mt-3 text-xs text-ink-500">
          {t('appointment.code')} <span className="tabular font-semibold tracking-wide text-ink-800">{a.code}</span>
        </p>
      </div>

      {!created.hasAccount ? (
        <div className="mt-4 flex w-full max-w-sm items-center gap-3 rounded-2xl bg-blush-100 p-4 text-left">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-white text-2xl text-rose-700">
            <QrCodeIcon fontSize="inherit" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">{t('invite.notInApp')}</p>
            <p className="text-sm text-ink-700">{t('invite.notInAppText')}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
        {!created.hasAccount ? (
          <Button size="lg" icon={QrCodeIcon} fullWidth onClick={() => setInviting(true)}>
            {t('invite.button')}
          </Button>
        ) : null}
        <ButtonLink to={lp(`/admin/appointments/${a.id}`)} variant={created.hasAccount ? 'primary' : 'soft'} size={created.hasAccount ? 'lg' : 'md'} fullWidth>
          {t('booking.openBooking')}
        </ButtonLink>
        <Button variant="ghost" size="md" icon={AddIcon} fullWidth onClick={onRestart}>
          {t('booking.another')}
        </Button>
      </div>

      {inviting ? (
        <InviteSheet
          client={{ id: a.client.id, name: a.client.name, surname: a.client.surname, phone: a.client.phone }}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </div>
  );
}
