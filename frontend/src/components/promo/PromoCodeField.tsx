import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button, TextField } from '@/components/ui';
import { ErrorIcon, LocalOfferIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { promoAmountText, promoProblemText, promoRefusal } from '@/lib/promo';
import type { PromoQuote } from '@/types/api';
import type { PromoState } from './usePromoQuote';

const CODE = /^[A-Z0-9]{3,20}$/;

/** Why the code doesn't apply, in words; null while there is nothing to say. */
function usePromoError(state: Pick<PromoState, 'error'>, desk = false): string | null {
  const { t } = useTranslation(['promo', 'common']);
  const { locale } = useLocale();
  const { currency } = useStudio();
  if (!state.error) return null;
  const refusal = promoRefusal(state.error);
  return refusal ? promoProblemText(t, refusal, { locale, currency, desk }) : errorMessage(t, state.error);
}

/**
 * "Have a promo code?" on the confirm step: a disclosure with the code field and Apply. The code
 * is checked live; once it applies, the price box shows it (with Remove) and the field folds away.
 */
export function PromoCodeField({
  state,
  onCode,
  desk = false,
  className,
}: {
  state: PromoState;
  /** A code to check (upper-case), or null to remove it. */
  onCode: (code: string | null) => void;
  /** Staff typing a client's code at the desk. */
  desk?: boolean;
  className?: string;
}) {
  const { t } = useTranslation(['promo', 'common']);
  const regionId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(state.code ?? '');
  const [invalid, setInvalid] = useState(false);
  const [shownCode, setShownCode] = useState(state.code);
  const serverError = usePromoError(state, desk);
  // The code was removed (from the price box): fold the field back, empty.
  if (shownCode !== state.code) {
    setShownCode(state.code);
    if (state.code === null) {
      setOpen(false);
      setDraft('');
      setInvalid(false);
    }
  }

  // Announced when a code applies (the field folds away and the price box shows it).
  const live = (
    <span className="sr-only" role="status">
      {state.quote ? t('promo:field.applied', { code: state.quote.code }) : ''}
    </span>
  );
  const expanded = open || state.code !== null;
  const typed = draft.trim().toUpperCase().replace(/[\s-]+/g, '');
  // The server's reason stays under the field until the code is changed.
  const error = invalid ? t('promo:problem.unknown') : typed === state.code ? serverError : null;

  const apply = () => {
    if (!CODE.test(typed)) {
      setInvalid(true);
      return;
    }
    if (typed === state.code) state.recheck();
    else onCode(typed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter checks the code instead of sending the booking form around it.
    if (event.key !== 'Enter') return;
    event.preventDefault();
    apply();
  };

  // The live region stays the same node whether or not the field shows, so the change is read out.
  if (state.quote) return <>{live}</>;
  return (
    <>
      {live}
      <section className={cx('flex flex-col gap-2', className)}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => {
            if (expanded) {
              setOpen(false);
              setDraft('');
              setInvalid(false);
              if (state.code) onCode(null);
            } else setOpen(true);
          }}
          className="press inline-flex min-h-11 items-center gap-2 self-start rounded-pill pr-2 text-[0.9375rem] font-semibold text-rose-700 underline-offset-4 hover:underline"
        >
          <LocalOfferIcon fontSize="inherit" className="text-lg" />
          {desk ? t('promo:admin.desk.toggle') : t('promo:field.toggle')}
        </button>
        {expanded ? (
          <div id={regionId} className="flex flex-col gap-1.5 animate-rise">
            <div className="flex items-center gap-2">
              <TextField
                label={t('promo:field.label')}
                hideLabel
                className="min-w-0 flex-1"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value.toUpperCase());
                  setInvalid(false);
                }}
                onKeyDown={onKeyDown}
                placeholder={t('promo:field.placeholder')}
                autoFocus={open}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                maxLength={24}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
              <Button size="lg" variant="soft" loading={state.checking} disabled={!typed} onClick={apply} className="shrink-0">
                {t('promo:field.apply')}
              </Button>
            </div>
            {error ? (
              <p id={errorId} role="alert" className="flex items-start gap-1.5 pl-1 text-sm text-red-600">
                <ErrorIcon fontSize="inherit" className="mt-[0.15rem] shrink-0 text-base" />
                <span>{error}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

/**
 * Inside the price box, under the total: the code's discount and what is left to pay. Promo codes
 * and loyalty discounts never add up: when the loyalty discount is bigger, the visit gets that one.
 */
export function PromoPriceLines({
  quote,
  total,
  priceFrom,
  loyaltyDiscount = 0,
  covers,
  onRemove,
}: {
  quote: PromoQuote;
  total: number;
  priceFrom: boolean;
  /** The loyalty discount this visit is expected to get (0 for none). */
  loyaltyDiscount?: number;
  /** Names of the services the code covers, when it covers only some. */
  covers?: string | null;
  onRemove?: () => void;
}) {
  const { t } = useTranslation(['promo', 'common']);
  const { currency } = useStudio();
  const promoWins = quote.discount > loyaltyDiscount;
  const discount = promoWins ? quote.discount : loyaltyDiscount;
  const note = !promoWins ? t('promo:line.loyaltyBigger') : loyaltyDiscount > 0 ? t('promo:line.notCombined') : t('promo:line.expected');
  return (
    <>
      <div className="flex items-start gap-3 border-t border-ink-100 px-4 py-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-pill bg-cyan-50 text-base text-cyan-800">
          <LocalOfferIcon fontSize="inherit" />
        </span>
        <span className="min-w-0 flex-1">
          {/* The amount sits on the title's line, so the explanation below gets the full width. */}
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words font-semibold">{t('promo:line.title', { code: quote.code })}</span>
            <span
              className={cx(
                'tabular shrink-0 whitespace-nowrap font-bold',
                promoWins ? 'text-rose-700' : 'text-ink-500 line-through decoration-ink-300',
              )}
            >
              {promoAmountText(t, quote, currency)}
            </span>
          </span>
          {covers ? <span className="block text-sm text-ink-600">{t('promo:line.covers', { services: covers })}</span> : null}
          <span className="block text-sm text-ink-600">{note}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label={t('promo:field.removeCode', { code: quote.code })}
              className="-ml-2 mt-0.5 inline-flex min-h-9 items-center rounded-pill px-2 text-sm font-semibold text-rose-700 underline-offset-4 hover:underline"
            >
              {t('promo:field.remove')}
            </button>
          ) : null}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 px-4 py-3">
        <span className="font-bold">{t('promo:line.toPay')}</span>
        <span className="tabular text-lg font-extrabold">{formatPrice(t, Math.max(0, total - discount), currency, priceFrom)}</span>
      </div>
    </>
  );
}

/** Moving a booking with a code: whether the code stays at the new time, or would come off (and why). */
export function PromoMoveNote({ state }: { state: PromoState }) {
  const { t } = useTranslation('promo');
  const error = usePromoError(state);
  if (!state.code) return null;
  if (state.quote) return <Alert tone="info">{t('move.keeps', { code: state.code })}</Alert>;
  if (!error || !promoRefusal(state.error)) return null;
  return <Alert tone="warning">{t('move.drops', { code: state.code, reason: error })}</Alert>;
}
