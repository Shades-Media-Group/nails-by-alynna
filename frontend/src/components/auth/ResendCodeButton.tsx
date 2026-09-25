import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { RefreshIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/errors';

/** Seconds left until `until` (a timestamp), updated every second. */
function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * "Send the code again", available after a visible countdown (the API sends at most one code
 * a minute). It stays focusable while waiting, so screen readers hear the time left, and its
 * result is said right under it (toasts would hide behind an open sheet).
 */
export function ResendCodeButton({
  onResend,
  seconds = 60,
  sentAt,
  className,
}: {
  onResend: () => Promise<unknown>;
  seconds?: number;
  /** When the current code was sent (e.g. restored after a reload); default: now. */
  sentAt?: number;
  className?: string;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [until, setUntil] = useState(() => (sentAt ?? Date.now()) + seconds * 1000);
  const left = Math.min(seconds, useSecondsLeft(until));
  const resend = useMutation({
    mutationFn: onResend,
    onSuccess: () => setUntil(Date.now() + seconds * 1000),
  });
  const waiting = left > 0;

  return (
    <div className={cx('flex flex-col', className)}>
      <Button
        variant="ghost"
        size="md"
        fullWidth
        icon={waiting ? undefined : RefreshIcon}
        loading={resend.isPending}
        aria-disabled={waiting || undefined}
        onClick={() => {
          if (!waiting && !resend.isPending) resend.mutate();
        }}
        className="aria-disabled:cursor-default aria-disabled:text-ink-600 aria-disabled:opacity-100!"
      >
        <span className="tabular">{waiting ? t('verify.resendIn', { time: clock(left) }) : t('verify.resend')}</span>
      </Button>
      <p role="status" className={cx('text-center text-sm', resend.isError ? 'text-red-600' : 'text-mint-700')}>
        {resend.isSuccess && waiting ? t('verify.resent') : resend.isError ? errorMessage(t, resend.error) : null}
      </p>
    </div>
  );
}
