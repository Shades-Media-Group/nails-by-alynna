import { useId, useRef, type KeyboardEvent, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { RealisticNailArt } from '@/components/brand/nails/RealisticNailArt';
import { FitText } from '@/components/ui';
import { CheckIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { NAIL_SHAPES } from '@/lib/nailShape';
import { SWATCH } from '@/lib/swatch';
import type { NailShape } from '@/types/api';

/** Arrow keys move the choice, as they do in a native radio group (either axis, wrapping). */
const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

interface NailShapePickerProps {
  value: NailShape | null;
  onChange: (shape: NailShape) => void;
  /** Continue was pressed without a shape: the message under the tiles says so. */
  invalid?: boolean;
  /** The section, so the page can bring it into view when the shape is missing. */
  ref?: Ref<HTMLElement>;
  /** At the desk: may stay unchosen (tapping the chosen shape clears it), with the staff's own hint. */
  optional?: boolean;
  hint?: string;
}

/**
 * The nail shape for the visit, asked before the services: the same fingertip and nail in four
 * outlines, so the shape is the only thing that differs. A chosen tile looks like a chosen
 * service card (dark ring, check). One radio group: Tab stops once, arrow keys change the shape.
 */
export function NailShapePicker({ value, onChange, invalid = false, ref, optional = false, hint }: NailShapePickerProps) {
  const { t } = useTranslation('booking');
  const id = useId();
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  // Tab lands on the chosen shape, or on the first one while none is chosen.
  const tabbable = value ? NAIL_SHAPES.indexOf(value) : 0;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = ARROWS[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + NAIL_SHAPES.length) % NAIL_SHAPES.length;
    onChange(NAIL_SHAPES[next]!);
    radios.current[next]?.focus();
  };

  return (
    <section ref={ref} aria-labelledby={`${id}-title`} className="scroll-mt-36">
      <h2 id={`${id}-title`} className="text-h3 font-extrabold">
        {t('shape.title')}
      </h2>
      <p id={`${id}-hint`} className="mt-1 text-sm text-ink-600">
        {hint ?? t('shape.hint')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-title`}
        aria-describedby={invalid ? `${id}-hint ${id}-error` : `${id}-hint`}
        aria-required={!optional}
        aria-invalid={invalid || undefined}
        className="mt-3 grid grid-cols-4 gap-2 sm:max-w-md"
      >
        {NAIL_SHAPES.map((shape, index) => {
          const checked = shape === value;
          return (
            <button
              key={shape}
              ref={(el) => {
                radios.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === tabbable ? 0 : -1}
              onClick={() => onChange(shape)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                'press relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl p-1.5 pb-2 transition-[background-color,box-shadow]',
                checked ? 'bg-blush-50 ring-2 ring-ink-900' : 'hover:bg-ink-50',
              )}
            >
              <span
                className={cx(
                  'flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg',
                  SWATCH.blush.field,
                )}
              >
                {/* Cropped closer than a service tile: here the outline of the nail is the point. */}
                <RealisticNailArt
                  art={`shape-${shape}`}
                  color="blush"
                  className="w-[115%] shrink-0"
                />
              </span>
              {/* Nearly the tile's full width, and the name shrinks to fit it rather than break
                  inside a word ("Квадрат", "Миндаль" on a 320px phone). */}
              <FitText className="-mx-0.5 self-stretch text-center text-sm font-semibold leading-tight text-ink-900">
                {t(`shape.${shape}`)}
              </FitText>
              {checked ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-pill bg-ink-900 text-[0.8125rem] text-white animate-pop"
                >
                  <CheckIcon fontSize="inherit" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/* Always in the page, so the message is read out when it appears. */}
      <p
        id={`${id}-error`}
        aria-live="polite"
        className={cx('text-sm font-semibold text-red-700', invalid && 'mt-2')}
      >
        {invalid ? t('shape.required') : null}
      </p>
    </section>
  );
}
