import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ME_KEY } from '@/app/auth';
import { OtpInput } from '@/components/auth/OtpInput';
import { ResendCodeButton } from '@/components/auth/ResendCodeButton';
import { clearPendingCode, readPendingCode, savePendingCode } from '@/components/auth/pendingCode';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/common/Alert';
import { Button, ButtonLink, PasswordField, TextField } from '@/components/ui';
import { EmailIcon, KeyIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { isEmail, passwordIssue } from '@/lib/validation';
import { isApiError } from '@/services/api/client';
import { authApi } from '@/services/api/endpoints';

/**
 * Forgot password: the email carries a 6-digit code (entered here with the new password) and
 * a link to /reset-password for whoever prefers to tap it.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { lp, locale } = useLocale();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [restored] = useState(() => readPendingCode('reset'));
  const [sentTo, setSentTo] = useState<string | null>(restored?.email ?? null);
  const send = useMutation({
    mutationFn: (value: string) => authApi.forgotPassword(value, locale),
    onSuccess: (_result, value) => {
      savePendingCode({ flow: 'reset', email: value });
      setSentTo(value);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!isEmail(email)) return;
    send.mutate(email.trim().toLowerCase());
  };

  if (sentTo) {
    return (
      <AuthLayout back={lp('/login/email')}>
        <ResetWithCode
          email={sentTo}
          sentAt={restored?.email === sentTo ? restored.at : undefined}
          onOtherEmail={() => {
            clearPendingCode();
            setSentTo(null);
            send.reset();
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout back={lp('/login/email')}>
      <h1 className="text-h1 font-extrabold">{t('forgot.title')}</h1>
      <p className="mt-2 text-ink-600">{t('forgot.subtitle')}</p>
      <form className="mt-7 flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        {send.isError ? <Alert>{errorMessage(t, send.error)}</Alert> : null}
        <TextField
          label={t('login.email')}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username email"
          autoCapitalize="none"
          icon={EmailIcon}
          placeholder={t('login.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={touched && !isEmail(email) ? t('common:validation.invalid_email') : undefined}
        />
        <Button type="submit" size="lg" fullWidth loading={send.isPending}>
          {t('forgot.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}

function ResetWithCode({ email, sentAt, onOtherEmail }: { email: string; sentAt?: number; onOtherEmail: () => void }) {
  const { t } = useTranslation(['auth', 'common']);
  const { lp, locale } = useLocale();
  const queryClient = useQueryClient();
  const errorId = useId();
  const codeErrorId = useId();
  const passwordField = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [errorKey, setErrorKey] = useState(0);

  const reset = useMutation({
    mutationFn: () => authApi.resetPasswordWithCode({ email, code, password }),
    onSuccess: () => {
      clearPendingCode();
      // Every session was signed out, this one included.
      queryClient.setQueryData(ME_KEY, null);
    },
    onError: (error) => {
      if (isApiError(error, 'CODE_INVALID')) {
        setCode('');
        setErrorKey((k) => k + 1);
      }
    },
  });

  const pwCode = passwordIssue(password, email);
  const serverFields = fieldErrors(t, reset.error);
  const codeError = touched && code.length < 6 ? t('common:validation.invalid_code') : undefined;
  const pwError = touched && pwCode ? t(`common:validation.${pwCode}`) : serverFields.password;
  const confirmError = touched && confirm !== password ? t('common:validation.passwords_mismatch') : undefined;
  const codeRejected = isApiError(reset.error, 'CODE_INVALID');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (code.length < 6 || pwCode || confirm !== password) return;
    reset.mutate();
  };

  if (reset.isSuccess) {
    return (
      <div className="animate-rise">
        <h1 className="text-h1 font-extrabold">{t('reset.doneTitle')}</h1>
        <p className="mt-3 text-ink-600">{t('reset.doneText')}</p>
        <ButtonLink to={lp('/login/email')} fullWidth className="mt-8">
          {t('reset.toLogin')}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <h1 className="text-h1 font-extrabold">{t('forgot.sentTitle')}</h1>
      <p className="mt-2 text-ink-600">
        <Trans t={t} i18nKey="forgot.codeText" values={{ email }} components={{ email: <strong className="break-all font-semibold text-ink-900" /> }} />
      </p>
      <p className="mt-2 text-sm text-ink-600">{t('verify.spam')}</p>

      <form className="mt-7 flex flex-col gap-5" noValidate onSubmit={onSubmit}>
        {reset.isError && !serverFields.password ? (
          <Alert>
            <span id={errorId}>{errorMessage(t, reset.error)}</span>
          </Alert>
        ) : null}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <div className="flex flex-col gap-1.5">
          <OtpInput
            label={t('verify.codeLabel')}
            value={code}
            onChange={(value) => {
              setCode(value);
              if (codeRejected) reset.reset();
            }}
            // A whole code: on to the new password.
            onComplete={() => passwordField.current?.focus()}
            invalid={Boolean(codeError) || codeRejected}
            errorKey={errorKey}
            describedBy={codeRejected ? errorId : codeError ? codeErrorId : undefined}
            busy={reset.isPending}
            autoFocus
          />
          {codeError ? (
            <p id={codeErrorId} className="pl-1 text-sm text-red-600">
              {codeError}
            </p>
          ) : null}
        </div>
        <PasswordField
          ref={passwordField}
          label={t('forgot.password')}
          name="new-password"
          autoComplete="new-password"
          icon={KeyIcon}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={pwError}
          hint={t('signup.passwordHint')}
        />
        <PasswordField
          label={t('forgot.confirm')}
          name="confirm-password"
          autoComplete="new-password"
          icon={KeyIcon}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirmError}
        />
        <Button type="submit" size="lg" fullWidth loading={reset.isPending}>
          {t('forgot.submitReset')}
        </Button>
      </form>

      <div className="mt-3 flex flex-col">
        <ResendCodeButton sentAt={sentAt} onResend={() => authApi.forgotPassword(email, locale)} />
        <Button variant="ghost" size="md" fullWidth onClick={onOtherEmail}>
          {t('verify.otherEmail')}
        </Button>
      </div>
    </div>
  );
}
