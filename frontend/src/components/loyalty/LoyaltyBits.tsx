import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui';
import { ChevronRightIcon, LoyaltyIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { cx } from '@/lib/cx';
import { formatPrice } from '@/lib/format';
import { ordinal } from '@/lib/ordinal';
import { loyaltyQueries } from '@/services/api/loyalty';
import type { AppointmentLoyalty } from '@/types/api';
import { StampCard } from './StampCard';
import { useLoyaltyForecast } from './useLoyaltyForecast';
import { useNextRewardText } from './useNextRewardText';

/** Home: the card at a glance, one tap to the full card and its QR code. */
export function LoyaltyTile({ className, style }: { className?: string; style?: CSSProperties }) {
  const { t } = useTranslation('loyalty');
  const { lp } = useLocale();
  const card = useQuery(loyaltyQueries.mine());
  const nextText = useNextRewardText();
  const status = card.data?.loyalty;
  if (!status?.enabled) return null;
  const next = nextText(status);

  return (
    <Link
      to={lp('/loyalty')}
      style={style}
      className={cx('press lift group flex items-center gap-3 rounded-2xl bg-blush-100 p-3 pr-4', className)}
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-white text-xl text-rose-600">
        <LoyaltyIcon fontSize="inherit" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[0.9375rem] font-bold">{t('tile.title')}</span>
          <StampCard status={status} size="sm" />
        </span>
        {/* The dots show the progress; the line below says what it leads to. */}
        <span className={cx('mt-0.5 block text-sm', next ? 'font-semibold text-rose-700 first-letter:uppercase' : 'text-ink-700')}>
          {next ?? t('stamps', { stamps: status.stamps, cycle: status.cycle })}
        </span>
      </span>
      <ChevronRightIcon
        fontSize="inherit"
        className="shrink-0 text-xl text-ink-400 transition-transform duration-200 ease-(--ease-out) group-hover:translate-x-1"
      />
    </Link>
  );
}

/** On a booking: the loyalty discount it gets (applied) or is expected to get. */
export function LoyaltyBadge({ loyalty, className }: { loyalty: AppointmentLoyalty | null | undefined; className?: string }) {
  const { t } = useTranslation('loyalty');
  if (!loyalty || loyalty.percent <= 0) return null;
  return (
    <Badge tone="rose" className={className}>
      {loyalty.predicted ? t('badge.predicted', { percent: loyalty.percent }) : t('badge.applied', { percent: loyalty.percent })}
    </Badge>
  );
}

/**
 * Booking details: which stamp this visit is on the card and the discount it carries.
 * `superseded`: the visit's promo code gives more, and the two never add up.
 */
export function LoyaltyLine({
  loyalty,
  currency,
  superseded = false,
}: {
  loyalty: AppointmentLoyalty | null | undefined;
  currency: string;
  superseded?: boolean;
}) {
  const { t } = useTranslation(['loyalty', 'common', 'promo']);
  if (!loyalty) return null;
  const hasDiscount = loyalty.percent > 0;
  return (
    <div className="flex items-start gap-3 border-t border-ink-100 px-4 py-3">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-pill bg-blush-100 text-base text-rose-600">
        <LoyaltyIcon fontSize="inherit" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {t('detail.title')} · {t('detail.visit', { visit: loyalty.visit, cycle: loyalty.cycle })}
        </span>
        <span className="block text-sm text-ink-600">
          {hasDiscount
            ? superseded
              ? t('promo:line.loyaltyNotCombined')
              : loyalty.predicted
                ? t('detail.expected')
                : t('detail.applied')
            : t('detail.noDiscount')}
        </span>
      </span>
      {hasDiscount ? (
        <span className={cx('tabular shrink-0 pt-0.5 font-bold', superseded ? 'text-ink-500 line-through decoration-ink-300' : 'text-rose-700')}>
          {t('detail.discount', { percent: loyalty.percent, amount: formatPrice(t, loyalty.discount, currency) })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Booking confirmation: when the visit being booked lands on a discount stamp, say so. Its
 * place on the card follows the completed visits and the other bookings before it.
 * `superseded`: a bigger promo code takes its place (the price box says so).
 */
export function LoyaltyConfirmNote({ start, superseded = false }: { start: string; superseded?: boolean }) {
  const { t } = useTranslation('loyalty');
  const { locale } = useLocale();
  const forecast = useLoyaltyForecast(start);
  if (!forecast || forecast.percent <= 0 || superseded) return null;
  return (
    <p className="flex items-start gap-2.5 rounded-xl bg-blush-100 px-4 py-3 text-[0.9375rem] font-semibold text-rose-700 animate-rise">
      <LoyaltyIcon fontSize="inherit" className="mt-0.5 shrink-0 text-lg" />
      {t('confirm', { ordinal: ordinal(forecast.visit, locale), percent: forecast.percent })}
    </p>
  );
}
