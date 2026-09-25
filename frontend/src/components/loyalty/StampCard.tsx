import { useTranslation } from 'react-i18next';
import { CheckIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import type { LoyaltyStatus } from '@/types/api';

interface StampCardProps {
  status: LoyaltyStatus;
  /** `sm` for the Home tile row, `lg` for the card page. */
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * The stamp card itself: one slot per visit of the card. Stamped visits are filled; visits
 * that carry a discount show it ("−15%") until they are stamped; the next visit is outlined.
 */
export function StampCard({ status, size = 'lg', className }: StampCardProps) {
  const { t } = useTranslation('loyalty');
  const slots = Array.from({ length: status.cycle }, (_, i) => i + 1);
  const reward = (visit: number) => status.rewards.find((r) => r.visit === visit)?.percent ?? 0;
  const lg = size === 'lg';

  return (
    <ol
      className={cx(
        lg ? 'grid gap-2.5' : 'flex gap-1',
        lg && (status.cycle % 4 === 0 ? 'grid-cols-4' : status.cycle % 5 === 0 ? 'grid-cols-5' : 'grid-cols-4'),
        className,
      )}
      aria-label={t('stamps', { stamps: status.stamps, cycle: status.cycle })}
    >
      {slots.map((visit) => {
        const stamped = visit <= status.stamps;
        const next = visit === status.stamps + 1;
        const percent = reward(visit);
        const label = [
          t('stampAria', { visit, cycle: status.cycle }),
          stamped ? t('stamped') : null,
          percent ? t('discount', { percent }) : null,
        ]
          .filter(Boolean)
          .join(', ');
        if (!lg) {
          return (
            <li
              key={visit}
              aria-label={label}
              className={cx(
                'size-2.5 rounded-pill',
                stamped ? 'bg-rose-500' : percent ? 'bg-white ring-2 ring-inset ring-rose-400' : 'bg-white/80 ring-1 ring-inset ring-ink-200',
              )}
            />
          );
        }
        return (
          <li key={visit} aria-label={label} className="flex flex-col items-center gap-1">
            <span
              className={cx(
                'relative flex aspect-square w-full max-w-16 items-center justify-center rounded-pill text-sm font-extrabold transition-colors',
                stamped
                  ? 'bg-rose-500 text-white shadow-[0_8px_18px_-10px_rgb(253_37_120/0.9)]'
                  : percent
                    ? 'border-2 border-dashed border-rose-300 bg-white text-rose-600'
                    : 'bg-white/70 text-ink-400 ring-1 ring-inset ring-ink-200',
                next && !stamped && 'outline-2 outline-offset-2 outline-ink-900/70',
              )}
            >
              {stamped ? (
                percent ? (
                  <span className="tabular">−{percent}%</span>
                ) : (
                  <CheckIcon fontSize="inherit" className="text-2xl" />
                )
              ) : percent ? (
                <span className="tabular">−{percent}%</span>
              ) : (
                <span className="tabular">{visit}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
