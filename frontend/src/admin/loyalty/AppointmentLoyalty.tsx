import { useTranslation } from 'react-i18next';
import { LoyaltyIcon } from '@/components/ui/icons';
import { useStudio } from '@/hooks/useStudio';
import { cx } from '@/lib/cx';
import { formatPrice } from '@/lib/format';
import type { StaffAppointment } from '@/types/api';

/**
 * On a booking (staff): which stamp the visit is on the client's card and, when it carries a
 * discount, what the client pays with it. Expected until the visit is marked done, then locked.
 * A bigger promo code takes the discount's place (the two never add up); the stamp still counts.
 */
export function AppointmentLoyalty({ appointment: a }: { appointment: StaffAppointment }) {
  const { t } = useTranslation(['loyalty', 'common', 'promo']);
  const { currency } = useStudio();
  const loyalty = a.loyalty;
  if (!loyalty) return null;
  const money = (amount: number) => formatPrice(t, amount, currency);
  const superseded = loyalty.percent > 0 && Boolean(a.promo?.applied);
  const discounted = loyalty.percent > 0 && !superseded;
  const pay = Math.max(0, a.totalPrice - loyalty.discount);

  return (
    <div className={cx('flex items-start gap-3 border-t border-ink-100 px-4 py-3', discounted && 'bg-blush-50')}>
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-pill bg-blush-100 text-base text-rose-600">
        <LoyaltyIcon fontSize="inherit" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold">
            {t('admin.appointment.title')} · {t('admin.appointment.stamp', { visit: loyalty.visit, cycle: loyalty.cycle })}
          </span>
          {loyalty.percent > 0 ? (
            <span className={cx('tabular font-bold', superseded ? 'text-ink-500 line-through decoration-ink-300' : 'text-rose-700')}>
              {t('admin.appointment.discount', { percent: loyalty.percent, amount: money(loyalty.discount) })}
            </span>
          ) : null}
        </p>
        {discounted ? (
          <p className="mt-0.5 text-sm font-semibold text-ink-900">
            {loyalty.predicted ? t('admin.appointment.toPay', { amount: money(pay) }) : t('admin.appointment.paid', { amount: money(pay) })}
          </p>
        ) : null}
        <p className="mt-0.5 text-sm text-ink-600">
          {superseded
            ? t('promo:admin.appointment.loyaltyNotCombined')
            : !loyalty.predicted
              ? t('admin.appointment.locked')
              : discounted
                ? t('admin.appointment.whenDone')
                : t('admin.appointment.stampWhenDone')}
        </p>
      </div>
    </div>
  );
}
