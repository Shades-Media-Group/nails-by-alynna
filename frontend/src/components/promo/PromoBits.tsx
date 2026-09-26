import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { InfoIcon, LocalOfferIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import { formatPrice } from '@/lib/format';
import { promoAmountText, promoValueText, visitDiscount } from '@/lib/promo';
import type { Appointment, RemovedPromo } from '@/types/api';

const isActive = (a: Pick<Appointment, 'status'>) => a.status === 'pending' || a.status === 'confirmed';

/** In a list: the code a booking carries, while it counts (upcoming, or the discount the visit got). */
export function PromoBadge({ appointment: a, className }: { appointment: Pick<Appointment, 'status' | 'promo'>; className?: string }) {
  const { t } = useTranslation(['promo', 'common']);
  const { currency } = useStudio();
  const p = a.promo;
  if (!p || !(isActive(a) || (a.status === 'completed' && p.applied))) return null;
  return (
    <Badge tone="cyan" className={className}>
      {t('promo:badge', { code: p.code, value: promoValueText(t, p.kind, p.value, currency) })}
    </Badge>
  );
}

/** What the promo code on a booking does, in the client's words (the loyalty line sits below it). */
function promoStatusText(t: TFunction, a: Pick<Appointment, 'status' | 'promo' | 'loyalty'>): string {
  const p = a.promo!;
  if (a.status === 'cancelled') return t('promo:line.released');
  if (a.status === 'no_show') return t('promo:line.missed');
  if (a.status === 'completed') return p.applied ? t('promo:line.applied') : t('promo:line.loyaltyWon');
  if (!p.applied) return t('promo:line.loyaltyBigger');
  return a.loyalty && a.loyalty.percent > 0 ? t('promo:line.notCombined') : t('promo:line.expected');
}

/** Booking details (client): the code, its discount, and whether this visit gets it. */
export function PromoLine({ appointment: a }: { appointment: Pick<Appointment, 'status' | 'promo' | 'loyalty'> }) {
  const { t } = useTranslation(['promo', 'common']);
  const { currency } = useStudio();
  const p = a.promo;
  if (!p) return null;
  const counts = p.applied && (isActive(a) || a.status === 'completed');
  return (
    <div className="flex items-start gap-3 border-t border-ink-100 px-4 py-3">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-pill bg-cyan-50 text-base text-cyan-800">
        <LocalOfferIcon fontSize="inherit" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-semibold">{t('promo:line.title', { code: p.code })}</span>
        <span className="block text-sm text-ink-600">{promoStatusText(t, a)}</span>
      </span>
      <span className={cx('tabular shrink-0 pt-0.5 font-bold', counts ? 'text-rose-700' : 'text-ink-500 line-through decoration-ink-300')}>
        {promoAmountText(t, p, currency)}
      </span>
    </div>
  );
}

/** "To pay": the list price less the one discount the visit gets (promo code or loyalty). */
export function ToPayLine({ appointment: a }: { appointment: Pick<Appointment, 'status' | 'promo' | 'loyalty' | 'totalPrice' | 'priceFrom'> }) {
  const { t } = useTranslation(['promo', 'common']);
  const { currency } = useStudio();
  const discount = visitDiscount(a);
  if (!discount.source || !(isActive(a) || a.status === 'completed')) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 px-4 py-3">
      <span className="font-bold">{t('promo:line.toPay')}</span>
      <span className="tabular text-lg font-extrabold">{formatPrice(t, discount.pay, currency, a.priceFrom)}</span>
    </div>
  );
}

/** A code that came off the booking when it was moved or restored, and why. */
export function PromoRemovedNote({ removed, className }: { removed: RemovedPromo; className?: string }) {
  const { t } = useTranslation('promo');
  return (
    <p className={cx('flex items-start gap-2.5 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-700', className)}>
      <InfoIcon fontSize="inherit" className="mt-0.5 shrink-0 text-base text-ink-500" />
      <span>{t('removed', { code: removed.code, reason: t(`removedReason.${removed.reason}`) })}</span>
    </p>
  );
}
