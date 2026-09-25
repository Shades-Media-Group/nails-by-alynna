import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/ui';
import { EmailIcon, WarningIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { isApiError } from '@/services/api/client';
import { authApi } from '@/services/api/endpoints';
import type { User } from '@/types/api';
import { OtpInput } from './OtpInput';
import { ResendCodeButton } from './ResendCodeButton';

interface VerifyEmailStepProps {
  email: string;
  remember: boolean;
  /** After sign-up, or after a login with an address that was never confirmed. */
  reason: 'signup' | 'login';
  resendAfterSec?: number;
  /** False when the email with the code did not go out: the step says so and offers to resend. */
  sent?: boolean;
  /** A new code went out (the step now reads "check your email"). */
  onResent?: () => void;
  /** When the code was sent, if this step was restored after a reload. */
  sentAt?: number;
  onVerified: (user: User) => void;
  /** Back to the form to use another address. */
  onChangeEmail: () => void;
}

/** "Check your email": the 6-digit code confirms the address and signs in. */
export function VerifyEmailStep({
  email,
  remember,
  reason,
  resendAfterSec = 60,
  sent = true,
  onResent,
  sentAt,
  onVerified,
  onChangeEmail,
}: VerifyEmailStepProps) {
  const { t } = useTranslation(['auth', 'common']);
  const { locale } = useLocale();
  const errorId = useId();
  const [code, setCode] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [delivered, setDelivered] = useState(sent);

  const verify = useMutation({
    mutationFn: (value: string) => authApi.verifyEmail({ email, code: value, remember }),
    onSuccess: onVerified,
    onError: (error) => {
      // A wrong code starts over; a network hiccup keeps what was typed.
      if (isApiError(error, 'CODE_INVALID')) {
        setCode('');
        setErrorKey((k) => k + 1);
      }
    },
  });

  const submit = (value: string) => {
    if (value.length === 6 && !verify.isPending) verify.mutate(value);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(code);
  };

  return (
    <div className="animate-rise">
      <span
        className={cx(
          'inline-flex size-14 items-center justify-center rounded-pill text-[1.75rem] text-ink-900',
          delivered ? 'bg-blush-100' : 'bg-peach-100',
        )}
        aria-hidden="true"
      >
        {delivered ? <EmailIcon fontSize="inherit" /> : <WarningIcon fontSize="inherit" />}
      </span>
      <h1 className="mt-5 text-h1 font-extrabold">
        {!delivered ? t('verify.notSentTitle') : reason === 'login' ? t('verify.loginTitle') : t('verify.title')}
      </h1>
      <p className="mt-2 text-ink-600" role={delivered ? undefined : 'alert'}>
        <Trans
          t={t}
          i18nKey={!delivered ? 'verify.notSentText' : reason === 'login' ? 'verify.loginText' : 'verify.text'}
          values={{ email }}
          components={{ email: <strong className="break-all font-semibold text-ink-900" /> }}
        />
      </p>
      {delivered ? <p className="mt-2 text-sm text-ink-600">{t('verify.spam')}</p> : null}
      {!delivered && import.meta.env.DEV ? (
        <p className="mt-2 font-mono text-xs text-ink-600">Development: the code is printed in the API terminal.</p>
      ) : null}

      <form className="mt-7 flex flex-col gap-5" noValidate onSubmit={onSubmit}>
        {verify.isError ? (
          <Alert>
            <span id={errorId}>{errorMessage(t, verify.error)}</span>
          </Alert>
        ) : null}
        <OtpInput
          label={t('verify.codeLabel')}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (verify.isError) verify.reset();
          }}
          onComplete={submit}
          invalid={isApiError(verify.error, 'CODE_INVALID')}
          errorKey={errorKey}
          describedBy={verify.isError ? errorId : undefined}
          busy={verify.isPending}
          autoFocus
        />
        <Button type="submit" size="lg" fullWidth loading={verify.isPending} disabled={code.length < 6}>
          {t('verify.submit')}
        </Button>
      </form>

      <div className="mt-3 flex flex-col">
        <ResendCodeButton
          seconds={resendAfterSec}
          sentAt={sentAt}
          onResend={async () => {
            await authApi.resendVerification(email, locale);
            setDelivered(true);
            onResent?.();
          }}
        />
        <Button variant="ghost" size="md" fullWidth onClick={onChangeEmail}>
          {t('verify.otherEmail')}
        </Button>
      </div>
    </div>
  );
}
