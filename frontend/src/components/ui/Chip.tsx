import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';
import type { IconComponent } from './icons';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  icon?: IconComponent;
  count?: number;
}

/** Filter / category chip. Selected state uses the ink action color. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, icon: Icon, count, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cx(
        'press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-pill px-4 text-sm font-semibold',
        selected ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-800 hover:bg-ink-100',
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon fontSize="inherit" className="text-base" /> : null}
      <span>{children}</span>
      {count !== undefined ? (
        <span
          className={cx(
            'tabular ml-0.5 inline-flex min-w-5 items-center justify-center rounded-pill px-1.5 text-xs',
            selected ? 'bg-white/20 text-white' : 'bg-white text-ink-700',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
});
