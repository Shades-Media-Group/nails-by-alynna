import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';
import { ExpandMoreIcon } from './icons';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hideLabel?: boolean;
  error?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

/** Native select (best on phones: the OS picker), styled like the text fields. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel, error, options, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={selectId} className={cx('text-sm font-medium text-ink-700', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          className={cx(
            'h-14 w-full appearance-none rounded-pill border bg-white pl-5 pr-12 text-base text-ink-900 outline-none',
            'transition-[box-shadow,border-color] duration-150',
            error
              ? 'border-red-500'
              : 'border-ink-200 hover:border-ink-300 focus:border-ink-900 focus:shadow-[0_0_0_4px_var(--color-blush-100)]',
          )}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ExpandMoreIcon
          fontSize="inherit"
          className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[1.35rem] text-ink-500"
        />
      </div>
      {error ? <p className="pl-1 text-sm text-red-600">{error}</p> : null}
    </div>
  );
});
