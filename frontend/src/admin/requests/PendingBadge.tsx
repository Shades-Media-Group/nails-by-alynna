import { useTranslation } from 'react-i18next';
import { cx } from '@/lib/cx';

/**
 * How many requests wait for an answer, after the label of the menu item that leads to them
 * ("Today"): a peach count on the icon's corner in the phone's bar (its link is `relative`), at
 * the end of the row in the sidebar. Screen readers hear it with the label.
 */
export function PendingBadge({
  count,
  placement,
}: {
  count: number | undefined;
  placement: 'bar' | 'side';
}) {
  const { t } = useTranslation('admin');
  if (!count) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className={cx(
          'tabular inline-flex items-center justify-center rounded-pill bg-peach-500 font-bold text-ink-900',
          placement === 'bar'
            ? 'absolute right-1 top-0 h-[1.125rem] min-w-[1.125rem] px-1 text-[0.6875rem] leading-none ring-2 ring-white'
            : 'ml-auto h-6 min-w-6 px-2 text-xs',
        )}
      >
        {count > 99 ? '99+' : count}
      </span>
      <span className="sr-only">{t('requests.count', { count })}</span>
    </>
  );
}
