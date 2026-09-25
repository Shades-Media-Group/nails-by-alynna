import type { ReactNode } from 'react';
import { CheckCircleIcon, ErrorIcon, InfoIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';

const TONES = {
  error: { box: 'bg-red-50 text-red-700', Icon: ErrorIcon },
  success: { box: 'bg-mint-50 text-mint-700', Icon: CheckCircleIcon },
  info: { box: 'bg-cyan-50 text-cyan-800', Icon: InfoIcon },
} as const;

/** Inline status message (announced to screen readers). */
export function Alert({ tone = 'error', children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  const { box, Icon } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm', box, className)}>
      <Icon fontSize="inherit" className="mt-[0.1rem] shrink-0 text-lg" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
