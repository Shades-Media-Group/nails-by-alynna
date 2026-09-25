import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export type BadgeTone = 'neutral' | 'rose' | 'cyan' | 'peach' | 'mint' | 'red' | 'lilac' | 'ink';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  rose: 'bg-rose-50 text-rose-700',
  cyan: 'bg-cyan-50 text-cyan-800',
  peach: 'bg-peach-50 text-peach-800',
  mint: 'bg-mint-50 text-mint-700',
  red: 'bg-red-50 text-red-700',
  lilac: 'bg-lilac-50 text-lilac-700',
  ink: 'bg-ink-900 text-white',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center whitespace-nowrap rounded-pill px-2.5 text-xs font-semibold',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
