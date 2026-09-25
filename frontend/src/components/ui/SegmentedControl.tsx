import { useRef, type KeyboardEvent } from 'react';
import { cx } from '@/lib/cx';

interface Option<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}

/** Tabs-style segmented control with roving focus (arrow keys). */
export function SegmentedControl<T extends string>({ value, onChange, options, label, className }: Props<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cx('inline-flex rounded-pill bg-ink-50 p-1', className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cx(
              'inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-pill px-4 text-sm font-semibold transition-colors duration-200',
              selected ? 'bg-white text-ink-900 shadow-[0_1px_3px_rgb(37_39_38/0.12)]' : 'text-ink-600 hover:text-ink-900',
            )}
          >
            {option.label}
            {option.count ? <span className="tabular text-xs text-ink-500">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
