import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, maxLength, value, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const count = typeof value === 'string' ? value.length : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink-700">
        {label}
      </label>
      <textarea
        ref={ref}
        id={inputId}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-note` : undefined}
        className={cx(
          'min-h-28 w-full resize-y rounded-xl border bg-white px-5 py-4 text-base text-ink-900 outline-none',
          'placeholder:text-ink-500 transition-[box-shadow,border-color] duration-150',
          error
            ? 'border-red-500 focus:shadow-[0_0_0_4px_var(--color-red-100)]'
            : 'border-ink-200 hover:border-ink-300 focus:border-ink-900 focus:shadow-[0_0_0_4px_var(--color-blush-100)]',
        )}
        {...rest}
      />
      <div className="flex justify-between gap-3 pl-1 text-sm">
        <p id={`${inputId}-note`} className={error ? 'text-red-600' : 'text-ink-600'}>
          {error ?? hint}
        </p>
        {maxLength && count !== undefined ? (
          <span className="tabular shrink-0 text-ink-500">
            {count}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  );
});
