import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ME_KEY } from '@/app/auth';
import { Alert } from '@/components/common/Alert';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button, ButtonLink, PasswordField } from '@/components/ui';
import { KeyIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { passwordIssue } from '@/lib/validation';
import { authApi } from '@/services/api/endpoints';

export default function ResetPasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { lp } = useLocale();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  // Keep the token out of the address bar, history and any Referer header.
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [token]);

  const reset = useMutation({
    mutationFn: () => authApi.resetPassword(token, password),
    onSuccess: () => queryClient.setQueryData(ME_KEY, null),
  });

  const pwCode = passwordIssue(password);
  const pwError = touched && pwCode ? t(`common:validation.${pwCode}`) : fieldErrors(t, reset.error).password;
  const confirmError = touched && confirm !== password ? t('common:validation.passwords_mismatch') : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (pwCode || confirm !== password) return;
    reset.mutate();
  };

  if (!token) {
    return (
      <AuthLayout back={lp('/login')}>
        <Alert>{t('reset.missingToken')}</Alert>
        <ButtonLink to={lp('/forgot-password')} variant="soft" fullWidth className="mt-6">
          {t('forgot.submit')}
        </ButtonLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout back={lp('/login')}>
      {reset.isSuccess ? (
        <div className="animate-rise">
          <h1 className="text-h1 font-extrabold">{t('reset.doneTitle')}</h1>
          <p className="mt-3 text-ink-600">{t('reset.doneText')}</p>
          <ButtonLink to={lp('/login/email')} fullWidth className="mt-8">
            {t('reset.toLogin')}
          </ButtonLink>
        </div>
      ) : (
        <>
          <h1 className="text-h1 font-extrabold">{t('reset.title')}</h1>
          <p className="mt-2 text-ink-600">{t('reset.subtitle')}</p>
          <form className="mt-7 flex flex-col gap-4" noValidate onSubmit={onSubmit}>
            {reset.isError && reset.error && !fieldErrors(t, reset.error).password ? (
              <Alert>{errorMessage(t, reset.error)}</Alert>
            ) : null}
            <input type="text" name="username" autoComplete="username" hidden readOnly value="" />
            <PasswordField
              label={t('reset.password')}
              name="new-password"
              autoComplete="new-password"
              icon={KeyIcon}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={pwError}
              hint={t('signup.passwordHint')}
            />
            <PasswordField
              label={t('reset.confirm')}
              name="confirm-password"
              autoComplete="new-password"
              icon={KeyIcon}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={confirmError}
            />
            <Button type="submit" size="lg" fullWidth loading={reset.isPending}>
              {t('reset.submit')}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
