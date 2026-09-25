import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/cx';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Accessible on/off switch (button role="switch"). */
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[0.9375rem] font-semibold text-ink-900">
          {label}
        </p>
        {description ? (
          <p id={`${id}-desc`} className="mt-0.5 text-sm text-ink-600">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-200',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-ink-900' : 'bg-ink-200',
        )}
      >
        <span
          className={cx(
            'block size-6 rounded-pill bg-white shadow-[0_2px_4px_rgb(37_39_38/0.25)] transition-transform duration-200 ease-(--ease-spring)',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  );
}
