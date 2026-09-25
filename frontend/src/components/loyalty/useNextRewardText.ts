import { useTranslation } from 'react-i18next';
import { useLocale } from '@/i18n/useLocale';
import { ordinal } from '@/lib/ordinal';
import type { LoyaltyStatus } from '@/types/api';

/** "Next visit: 15% off" / "15% off your 4th visit". */
export function useNextRewardText() {
  const { t } = useTranslation('loyalty');
  const { locale } = useLocale();
  return (status: LoyaltyStatus): string | null => {
    const next = status.nextReward;
    if (!status.enabled || !next) return null;
    return next.inVisits === 1
      ? t('next', { percent: next.percent })
      : t('nextOn', { percent: next.percent, ordinal: ordinal(next.visit, locale) });
  };
}
