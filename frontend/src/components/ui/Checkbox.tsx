import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { CheckIcon } from './icons';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={inputId} className="group flex cursor-pointer items-start gap-3 text-sm leading-snug text-ink-700">
        <span className="relative mt-px inline-flex size-6 shrink-0">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            className={cx(
              'peer size-6 cursor-pointer appearance-none rounded-[0.5rem] border-[1.5px] bg-white transition-colors',
              'checked:border-ink-900 checked:bg-ink-900',
              error ? 'border-red-500' : 'border-ink-300 group-hover:border-ink-500',
            )}
            {...rest}
          />
          <CheckIcon
            fontSize="inherit"
            className="pointer-events-none absolute inset-0 m-auto text-base text-white opacity-0 transition-opacity peer-checked:opacity-100"
          />
        </span>
        <span className="pt-0.5">{label}</span>
      </label>
      {error ? (
        <p className="pl-9 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
