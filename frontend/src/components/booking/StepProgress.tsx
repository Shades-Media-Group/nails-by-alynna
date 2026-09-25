import { useTranslation } from 'react-i18next';
import { cx } from '@/lib/cx';

const TIP = 'M8 1C12.5 1 15 6 15 12V21C15 23 13.5 24 11.5 24H4.5C2.5 24 1 23 1 21V12C1 6 3.5 1 8 1Z';

/**
 * Booking progress as a row of nail tips that get "painted" one by one — the product's
 * own progress bar instead of a generic line.
 */
export function StepProgress({ steps, current }: { steps: string[]; current: number }) {
  const { t } = useTranslation('booking');
  return (
    <div className="flex items-center gap-3">
      <ol className="flex items-end gap-1.5" aria-label={t('flow.stepOf', { current: current + 1, total: steps.length })}>
        {steps.map((label, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo';
          return (
            <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="flex">
              <span className="sr-only">{label}</span>
              <svg viewBox="0 0 16 25" className={cx('h-6 w-4 transition-transform duration-300', state === 'current' && '-translate-y-0.5')} aria-hidden="true">
                <path
                  d={TIP}
                  className={cx(
                    'transition-colors duration-300',
                    state === 'done' && 'fill-rose-500',
                    state === 'current' && 'fill-rose-400',
                    state === 'todo' && 'fill-ink-100',
                  )}
                />
                {state !== 'todo' ? <path d="M5 6.5C5 5 5.8 3.7 6.8 3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.8" /> : null}
              </svg>
            </li>
          );
        })}
      </ol>
      <p className="text-sm font-semibold text-ink-700">
        {steps[current]} <span className="font-normal text-ink-500">· {t('flow.stepOf', { current: current + 1, total: steps.length })}</span>
      </p>
    </div>
  );
}
