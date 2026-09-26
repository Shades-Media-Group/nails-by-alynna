import { useTranslation } from 'react-i18next';
import { PromoRemovedNote } from '@/components/promo/PromoBits';
import { LocalOfferIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import { formatPrice } from '@/lib/format';
import { promoAmountText } from '@/lib/promo';
import type { StaffAppointment } from '@/types/api';

/**
 * On a booking (staff): its promo code, what the client pays with it, and whether the visit gets
 * it. It never adds up with the loyalty discount: the bigger one wins, locked in at completion.
 */
export function AppointmentPromo({ appointment: a }: { appointment: StaffAppointment }) {
  const { t } = useTranslation(['promo', 'common']);
  const { currency } = useStudio();
  const p = a.promo;
  if (!p) {
    return a.promoRemoved ? (
      <div className="border-t border-ink-100 px-4 py-3">
        <PromoRemovedNote removed={a.promoRemoved} />
      </div>
    ) : null;
  }
  const active = a.status === 'pending' || a.status === 'confirmed';
  const counts = p.applied && (active || a.status === 'completed');
  const pay = formatPrice(t, Math.max(0, a.totalPrice - p.discount), currency, a.priceFrom);
  const note =
    a.status === 'cancelled' || a.status === 'no_show'
      ? t('admin.appointment.released')
      : a.status === 'completed'
        ? p.applied
          ? t('admin.appointment.applied')
          : t('admin.appointment.loyaltyWon')
        : p.applied
          ? t('admin.appointment.whenDone')
          : t('admin.appointment.loyaltyBigger');

  return (
    <div className={cx('flex items-start gap-3 border-t border-ink-100 px-4 py-3', counts && 'bg-cyan-50/60')}>
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-pill bg-cyan-50 text-base text-cyan-800">
        <LocalOfferIcon fontSize="inherit" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="break-words font-semibold">{t('admin.appointment.title', { code: p.code })}</span>
          <span className={cx('tabular font-bold', counts ? 'text-rose-700' : 'text-ink-500 line-through decoration-ink-300')}>
            {promoAmountText(t, p, currency)}
          </span>
        </p>
        {counts ? (
          <p className="mt-0.5 text-sm font-semibold text-ink-900">
            {a.status === 'completed' ? t('admin.appointment.paid', { amount: pay }) : t('admin.appointment.toPay', { amount: pay })}
          </p>
        ) : null}
        <p className="mt-0.5 text-sm text-ink-600">{note}</p>
      </div>
    </div>
  );
}
