import { cx } from '@/lib/cx';

/** Loading placeholder that mirrors the shape of the content it replaces. */
export function Skeleton({ className, rounded = 'md' }: { className?: string; rounded?: 'md' | 'xl' | 'pill' }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'skeleton block',
        rounded === 'pill' && 'rounded-pill',
        rounded === 'xl' && 'rounded-xl',
        className,
      )}
    />
  );
}
