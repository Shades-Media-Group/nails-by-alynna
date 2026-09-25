import { useTranslation } from 'react-i18next';
import logoUrl from '@/assets/brand/logo.svg';
import markUrl from '@/assets/brand/mark.svg';
import { cx } from '@/lib/cx';

/**
 * The studio's logo (generated from brand/logo.svg).
 * - full: "nails · by alynna · — NAIL SALON —"
 * - mark: "nails · by alynna" for compact places (headers, tab bar, favicons)
 */
export function Logo({ variant = 'full', className }: { variant?: 'full' | 'mark'; className?: string }) {
  const { t } = useTranslation('common');
  const full = variant === 'full';
  return (
    <img
      src={full ? logoUrl : markUrl}
      alt={t('a11y.logoAlt')}
      width={full ? 865 : 865}
      height={full ? 803 : 734}
      decoding="async"
      draggable={false}
      className={cx('h-auto select-none', className)}
    />
  );
}
