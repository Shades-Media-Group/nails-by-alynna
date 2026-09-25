import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { SWATCH, type SwatchColor } from '@/lib/swatch';
import type { IconComponent } from './icons';

/** Empty states teach the next step instead of saying "nothing here". */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'blush',
  className,
}: {
  icon: IconComponent;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: SwatchColor;
  className?: string;
}) {
  const swatch = SWATCH[tone];
  return (
    <div className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
      <span className={cx('mb-5 inline-flex size-16 items-center justify-center rounded-pill text-[1.9rem]', swatch.field, swatch.accent)}>
        <Icon fontSize="inherit" />
      </span>
      <h3 className="text-h3 font-bold">{title}</h3>
      {description ? <p className="mt-2 max-w-xs text-sm text-ink-600">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
