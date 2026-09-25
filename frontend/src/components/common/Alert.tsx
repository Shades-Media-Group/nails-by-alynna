import type { ReactNode } from 'react';
import { CheckCircleIcon, ErrorIcon, InfoIcon, WarningIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';

// Errors arrive with a short shake (something needs fixing); the rest rise in gently.
const TONES = {
  error: { box: 'bg-red-50 text-red-700 animate-shake', Icon: ErrorIcon },
  warning: { box: 'bg-peach-50 text-peach-800 animate-rise', Icon: WarningIcon },
  success: { box: 'bg-mint-50 text-mint-700 animate-rise', Icon: CheckCircleIcon },
  info: { box: 'bg-cyan-50 text-cyan-800 animate-rise', Icon: InfoIcon },
} as const;

export type AlertTone = keyof typeof TONES;

/** Inline status message (announced to screen readers). */
export function Alert({ tone = 'error', children, className }: { tone?: AlertTone; children: ReactNode; className?: string }) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={cx('flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm', box, className)}
    >
      <Icon fontSize="inherit" className="mt-[0.1rem] shrink-0 animate-pop text-lg" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
