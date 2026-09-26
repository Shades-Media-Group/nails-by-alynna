import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RealisticNailArt } from '@/components/brand/nails/RealisticNailArt';
import { LoyaltyConfirmNote } from '@/components/loyalty/LoyaltyBits';
import { useLoyaltyForecast } from '@/components/loyalty/useLoyaltyForecast';
import { Alert } from '@/components/common/Alert';
import { PromoCodeField, PromoMoveNote, PromoPriceLines } from '@/components/promo/PromoCodeField';
import type { PromoState } from '@/components/promo/usePromoQuote';
import { Button, TextField, Textarea } from '@/components/ui';
import { CallIcon, ScheduleIcon } from '@/components/ui/icons';
import { useCatalog, useI18nText, useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { formatDateTime, formatDuration, formatPrice } from '@/lib/format';
import { SWATCH } from '@/lib/swatch';
import type { Service, Slot } from '@/types/api';

interface ConfirmStepProps {
  mode: 'new' | 'reschedule';
  services: Service[];
  slot: Slot;
  masterName: string | null;
  needsPhone: boolean;
  phone: string;
  onPhone: (value: string) => void;
  phoneError?: string;
  notes: string;
  onNotes: (value: string) => void;
  submitting: boolean;
  error: string | null;
  onEdit: (step: 'services' | 'time') => void;
  onSubmit: () => void;
  /** The promo code checked against this visit (see usePromoQuote). */
  promo?: PromoState;
  /** New bookings: apply a code, or remove it with null. */
  onPromoCode?: (code: string | null) => void;
}

/** Everything the client agrees to, in one place: what, when, who, how much, and the rules. */
export function ConfirmStep(props: ConfirmStepProps) {
  const { mode, services, slot, masterName, needsPhone, phone, onPhone, phoneError, notes, onNotes, submitting, error, onEdit, onSubmit, promo, onPromoCode } = props;
  const { t } = useTranslation(['booking', 'common']);
  const { locale } = useLocale();
  const pick = useI18nText();
  const catalog = useCatalog();
  const { data: config, timeZone, currency } = useStudio();
  const booking = config?.booking;

  const durationMin = services.reduce((sum, s) => sum + s.durationMin, 0);
  const total = services.reduce((sum, s) => sum + s.price, 0);
  const priceFrom = services.some((s) => s.priceFrom);
  const deadline = new Date(new Date(slot.start).getTime() - (booking?.cancellationWindowHours ?? 0) * 3_600_000);
  const approval = mode === 'new' && booking?.requireApproval;
  // A promo code and the loyalty discount never add up: the visit gets the bigger one.
  const forecast = useLoyaltyForecast(slot.start);
  const loyaltyDiscount = mode === 'new' && forecast ? Math.round((total * forecast.percent) / 100) : 0;
  // Moving a booking keeps its discount as it was (the note below says whether the code stays).
  const quote = mode === 'new' ? (promo?.quote ?? null) : null;
  const covers = quote?.serviceIds ? services.filter((s) => quote.serviceIds?.includes(s.id)).map((s) => pick(s.name)).join(', ') : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <section className="rounded-2xl bg-white ring-1 ring-inset ring-ink-100">
        {/* The whole row changes the time, not just the word "Change". */}
        <button
          type="button"
          onClick={() => onEdit('time')}
          className="group flex w-full items-start gap-3 rounded-t-2xl p-4 text-left transition-colors hover:bg-ink-50/70 active:bg-ink-50 focus-visible:bg-ink-50"
        >
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-ink-900 text-lg text-white">
            <ScheduleIcon fontSize="inherit" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-ink-600">{t('flow.when')}</span>
            <span className="block font-bold first-letter:uppercase">{formatDateTime(slot.start, locale, timeZone)}</span>
            <span className="block text-sm text-ink-600">
              {formatDuration(t, durationMin)}
              {masterName ? ` · ${t('flow.withMaster', { name: masterName })}` : ''}
            </span>
          </span>
          <span className="shrink-0 rounded-pill px-2 py-1 text-sm font-semibold text-rose-700 underline-offset-4 group-hover:underline">
            {t('flow.change')}
          </span>
        </button>
        <ul className="divide-y divide-ink-100 border-t border-ink-100">
          {services.map((service) => {
            const color = catalog.categoryById.get(service.categoryId)?.color ?? 'blush';
            return (
              <li key={service.id} className="flex items-center gap-3 px-4 py-3">
                <span className={cx('flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg', SWATCH[color].field)}>
                  <RealisticNailArt art={service.art} color={color} className="w-10" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-semibold leading-snug">{pick(service.name)}</span>
                  <span className="block text-sm text-ink-600">{formatDuration(t, service.durationMin)}</span>
                </span>
                <span className="tabular shrink-0 text-[0.9375rem] font-semibold">
                  {formatPrice(t, service.price, currency, service.priceFrom)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 px-4 py-3">
          <span className="font-bold">{t('flow.total')}</span>
          <span className={cx('tabular', quote ? 'font-semibold' : 'text-lg font-extrabold')}>{formatPrice(t, total, currency, priceFrom)}</span>
        </div>
        {quote ? (
          <PromoPriceLines
            quote={quote}
            total={total}
            priceFrom={priceFrom}
            loyaltyDiscount={loyaltyDiscount}
            covers={covers}
            onRemove={onPromoCode ? () => onPromoCode(null) : undefined}
          />
        ) : null}
        {mode === 'new' ? (
          <div className="flex items-center justify-between gap-3 border-t border-ink-100 px-4 py-3">
            <p className="text-sm text-ink-600">{t('flow.payAtStudio')}</p>
            <button type="button" onClick={() => onEdit('services')} className="shrink-0 rounded-pill px-2 py-1 text-sm font-semibold text-rose-700 underline-offset-4 hover:underline">
              {t('flow.change')}
            </button>
          </div>
        ) : null}
      </section>

      {mode === 'new' && promo && onPromoCode ? <PromoCodeField state={promo} onCode={onPromoCode} /> : null}
      {mode === 'reschedule' && promo ? <PromoMoveNote state={promo} /> : null}
      {mode === 'new' ? <LoyaltyConfirmNote start={slot.start} superseded={Boolean(quote && quote.discount > loyaltyDiscount)} /> : null}

      {needsPhone ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-h3 font-bold">{t('flow.phoneTitle')}</h2>
          <p className="text-sm text-ink-600">{t('flow.phoneText')}</p>
          <TextField
            label={t('flow.phoneLabel')}
            name="tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="069 123 456"
            icon={CallIcon}
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            error={phoneError}
            required
          />
        </section>
      ) : null}

      {mode === 'new' ? (
        <Textarea
          label={t('flow.notes')}
          placeholder={t('flow.notesPlaceholder')}
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          maxLength={500}
          rows={3}
        />
      ) : null}

      <section className="rounded-xl bg-ink-50 p-4 text-sm text-ink-700">
        <h2 className="font-bold text-ink-900">{t('flow.policyTitle')}</h2>
        <p className="mt-1">{t('flow.freeUntil', { date: formatDateTime(deadline, locale, timeZone) })}</p>
        {booking?.policy && pick(booking.policy) ? <p className="mt-1 text-ink-600">{pick(booking.policy)}</p> : null}
      </section>

      {approval ? <Alert tone="info">{t('flow.approvalNotice')}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        {mode === 'reschedule' ? t('flow.confirmReschedule') : approval ? t('flow.confirmRequest') : t('flow.confirm')}
      </Button>
    </form>
  );
}
