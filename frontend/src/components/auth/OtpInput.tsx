import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cx } from '@/lib/cx';

interface OtpInputProps {
  /** Digits entered so far (0–length characters). */
  value: string;
  onChange: (value: string) => void;
  /** Called when the last digit arrives (typing, paste, autofill) and on Enter once complete. */
  onComplete?: (code: string) => void;
  /** Visible label, e.g. "6-digit code". */
  label: string;
  length?: number;
  invalid?: boolean;
  /** Increase to shake the boxes again (a new wrong code). */
  errorKey?: number;
  /** id of the element that explains the error. */
  describedBy?: string;
  /** Checking the code: typing pauses but the keyboard stays up. */
  busy?: boolean;
  autoFocus?: boolean;
}

/**
 * One-time code shown as six boxes, backed by ONE real input: the keyboard, Backspace (also on
 * Android keyboards that send no key codes), paste and the "From Mail" autofill of iOS and
 * Android all work natively, and screen readers meet a single labelled field.
 */
export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { value, onChange, onComplete, label, length = 6, invalid, errorKey = 0, describedBy, busy, autoFocus },
  ref,
) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const boxes = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => input.current as HTMLInputElement);

  const set = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, length);
    if (digits === value) return;
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  };

  useEffect(() => {
    if (autoFocus) input.current?.focus();
    // Only when the field appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A wrong code: shake the boxes (the shared "shake" animation) and keep the keyboard up.
  useEffect(() => {
    if (!errorKey) return;
    const el = boxes.current;
    if (el) {
      el.classList.remove('animate-shake');
      void el.offsetWidth; // restart the animation
      el.classList.add('animate-shake');
    }
    input.current?.focus();
  }, [errorKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    // Enter never submits half a code; a whole one goes to onComplete (verify, or next field).
    if (value.length < length || onComplete) event.preventDefault();
    if (value.length === length) onComplete?.(value);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (!busy) set(event.clipboardData.getData('text'));
  };

  // The caret always stays after the last digit: typing appends, Backspace removes the last.
  const keepCaretAtEnd = () => {
    const el = input.current;
    if (el && (el.selectionStart !== el.value.length || el.selectionEnd !== el.value.length)) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  };

  const active = Math.min(value.length, length - 1);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-700">
        {label}
      </label>
      <div className="relative">
        <div ref={boxes} aria-hidden="true" className="flex justify-between gap-2 sm:justify-start">
          {Array.from({ length }, (_, index) => {
            const digit = value[index] ?? '';
            const current = focused && !busy && index === active && (value.length < length || index === length - 1);
            return (
              <div
                key={index}
                data-otp-box=""
                className={cx(
                  'tabular flex h-14 w-12 min-w-0 shrink items-center justify-center rounded-lg border text-2xl font-bold transition-[box-shadow,border-color,background-color] duration-150 sm:w-13',
                  busy ? 'bg-ink-50 text-ink-500' : 'bg-white text-ink-900',
                  invalid
                    ? 'border-red-500'
                    : current
                      ? 'border-ink-900 shadow-[0_0_0_4px_var(--color-blush-100)]'
                      : 'border-ink-200',
                )}
              >
                {digit ||
                  (current && value.length < length ? <span className="h-7 w-0.5 animate-pulse rounded-full bg-rose-500" /> : null)}
              </div>
            );
          })}
        </div>
        <input
          ref={input}
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          enterKeyHint="done"
          maxLength={length}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          // Password managers: this is not a login field.
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
          value={value}
          readOnly={busy}
          aria-busy={busy || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            if (!busy) set(e.target.value);
          }}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onSelect={keepCaretAtEnd}
          onFocus={() => {
            setFocused(true);
            keepCaretAtEnd();
          }}
          onBlur={() => setFocused(false)}
          className="absolute inset-0 h-full w-full cursor-text rounded-lg border-0 bg-transparent text-2xl text-transparent caret-transparent outline-none [-webkit-text-fill-color:transparent] selection:bg-transparent"
        />
      </div>
    </div>
  );
});
