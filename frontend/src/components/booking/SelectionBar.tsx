import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { ArrowForwardIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { formatDuration, formatPrice } from '@/lib/format';

interface SelectionBarProps {
  count: number;
  durationMin: number;
  price: number;
  priceFrom: boolean;
  currency: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Extra line (e.g. the chosen time) shown above the totals. */
  detail?: ReactNode;
  /** Leave room for the floating tab bar underneath. */
  aboveTabBar?: boolean;
}

/** Sticky summary of the booking so far: count · duration · price, and the next step. */
export function SelectionBar({
  count,
  durationMin,
  price,
  priceFrom,
  currency,
  actionLabel,
  onAction,
  disabled,
  loading,
  detail,
  aboveTabBar,
}: SelectionBarProps) {
  const { t } = useTranslation(['booking', 'common']);
  return (
    <div
      className={cx(
        'fixed inset-x-3 z-40 animate-rise lg:inset-x-auto lg:left-1/2 lg:w-[34rem] lg:-translate-x-1/2',
        aboveTabBar ? 'bottom-[calc(var(--safe-bottom)+5.25rem)] lg:bottom-6' : 'bottom-[calc(var(--safe-bottom)+0.75rem)] lg:bottom-6',
      )}
    >
      <div className="flex items-center gap-3 rounded-2xl bg-ink-900 p-2.5 pl-5 text-white shadow-float">
        <div className="min-w-0 flex-1" aria-live="polite">
          {detail ? <p className="truncate text-xs text-rose-200">{detail}</p> : null}
          <p className="truncate text-sm font-semibold">
            {t('services.summary', { count })} · {formatDuration(t, durationMin)}
          </p>
          <p className="tabular text-sm text-white/70">{formatPrice(t, price, currency, priceFrom)}</p>
        </div>
        <Button
          size="md"
          variant="soft"
          trailingIcon={ArrowForwardIcon}
          onClick={onAction}
          disabled={disabled}
          loading={loading}
          className="shrink-0"
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
