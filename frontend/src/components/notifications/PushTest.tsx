import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, toast } from '@/components/ui';
import { CheckIcon, CloseIcon, TimerIcon } from '@/components/ui/icons';
import { ApiError } from '@/services/api/client';
import { errorMessage } from '@/lib/errors';
import { notificationsApi, type PushDelivery, type PushTestResult } from '@/services/api/endpoints';

/** Time to lock the phone or close the app before the test goes out (the API waits, not the phone). */
export const TEST_DELAY_SEC = 5;

type Phase =
  | { step: 'idle' }
  | { step: 'waiting'; left: number }
  | { step: 'sending' }
  | { step: 'done'; result: PushTestResult }
  /** The app was put away meanwhile and the answer got lost: the notification itself tells. */
  | { step: 'lost' };

/**
 * "Send a test notification": the API sends it to every device with notifications on after a
 * few seconds (so the phone can be locked or the app closed first), then this says how many
 * devices it went to, and how each push service answered.
 */
export function PushTest() {
  const { t } = useTranslation(['push', 'common']);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const cleanup = useRef<() => void>(() => undefined);
  useEffect(() => () => cleanup.current(), []);

  const send = () => {
    let wentAway = document.visibilityState === 'hidden';
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') wentAway = true;
    };
    document.addEventListener('visibilitychange', onVisibility);
    const started = Date.now();
    setPhase({ step: 'waiting', left: TEST_DELAY_SEC });
    const timer = window.setInterval(() => {
      const left = TEST_DELAY_SEC - Math.floor((Date.now() - started) / 1000);
      setPhase((phase) =>
        phase.step === 'waiting'
          ? left > 0
            ? { step: 'waiting', left }
            : { step: 'sending' }
          : phase,
      );
    }, 250);
    cleanup.current = () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    notificationsApi
      .test(TEST_DELAY_SEC)
      .then(
        (result) => setPhase({ step: 'done', result }),
        (error: unknown) => {
          if (wentAway && error instanceof ApiError && error.code === 'NETWORK') {
            setPhase({ step: 'lost' });
            return;
          }
          setPhase({ step: 'idle' });
          toast.error(errorMessage(t, error));
        },
      )
      .finally(() => cleanup.current());
  };

  const busy = phase.step === 'waiting' || phase.step === 'sending';
  return (
    <div className="mt-3">
      <Button
        variant="outline"
        size="md"
        loading={phase.step === 'sending'}
        disabled={busy}
        onClick={send}
      >
        {t('test.action')}
      </Button>
      <div aria-live="polite" className="text-sm">
        {phase.step === 'waiting' ? (
          <p className="mt-2 flex items-start gap-2 text-ink-700">
            <TimerIcon
              fontSize="inherit"
              className="mt-0.5 shrink-0 text-base"
              aria-hidden="true"
            />
            <span>
              {/* The seconds tick on screen only; a screen reader hears the sentence once. */}
              <span className="tabular font-semibold" aria-hidden="true">
                {t('test.countdown', { count: phase.left })}
              </span>
              <span className="sr-only">{t('test.countdown', { count: TEST_DELAY_SEC })}</span>
              {'. '}
              {t('test.countdownHint')}
            </span>
          </p>
        ) : phase.step === 'sending' ? (
          <p className="mt-2 text-ink-600">{t('test.sending')}</p>
        ) : phase.step === 'lost' ? (
          <p className="mt-2 text-ink-600">{t('test.lost')}</p>
        ) : phase.step === 'done' ? (
          <TestResult result={phase.result} />
        ) : null}
      </div>
    </div>
  );
}

function TestResult({ result }: { result: PushTestResult }) {
  const { t } = useTranslation('push');
  if (result.sent === 0) return <p className="mt-2 text-red-700">{t('test.none')}</p>;
  return (
    <div className="mt-2">
      <p className="font-semibold text-ink-900">{t('test.sent', { count: result.sent })}</p>
      {result.deliveries.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {result.deliveries.map((delivery, i) => (
            <li key={i} className="flex items-start gap-2 text-ink-700">
              <span
                className={
                  delivery.outcome === 'sent'
                    ? 'mt-0.5 shrink-0 text-mint-700'
                    : 'mt-0.5 shrink-0 text-red-600'
                }
                aria-hidden="true"
              >
                {delivery.outcome === 'sent' ? (
                  <CheckIcon fontSize="inherit" />
                ) : (
                  <CloseIcon fontSize="inherit" />
                )}
              </span>
              <span>
                <span className="font-medium text-ink-900">{deviceLabel(t, delivery)}</span>
                {' · '}
                {outcomeText(t, delivery)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** iPad web apps say "Macintosh": a Mac with Apple's push service may be either. */
function deviceLabel(t: (key: string) => string, delivery: PushDelivery): string {
  const apple = delivery.device === 'mac' && delivery.service === 'apple';
  return t(`test.device.${apple ? 'macOrIpad' : delivery.device}`);
}

function outcomeText(
  t: (key: string, options?: Record<string, unknown>) => string,
  delivery: PushDelivery,
): string {
  const service = t(`test.service.${delivery.service}`);
  if (delivery.outcome === 'sent') return t('test.outcome.sent', { service });
  if (delivery.outcome === 'gone') return t('test.outcome.gone');
  return delivery.status === null
    ? t('test.outcome.unreachable', { service })
    : t('test.outcome.failed', { service, status: delivery.status });
}
