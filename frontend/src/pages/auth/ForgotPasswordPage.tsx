import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/common/Alert';
import { Button, ButtonLink, TextField } from '@/components/ui';
import { EmailIcon } from '@/components/ui/icons';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { isEmail } from '@/lib/validation';
import { authApi } from '@/services/api/endpoints';

export default function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { lp, locale } = useLocale();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const send = useMutation({ mutationFn: (value: string) => authApi.forgotPassword(value, locale) });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!isEmail(email)) return;
    send.mutate(email.trim());
  };

  return (
    <AuthLayout back={lp('/login/email')}>
      {send.isSuccess ? (
        <div className="animate-rise">
          <h1 className="text-h1 font-extrabold">{t('forgot.sentTitle')}</h1>
          <p className="mt-3 text-ink-600">{t('forgot.sentText', { email: email.trim() })}</p>
          <ButtonLink to={lp('/login/email')} variant="soft" fullWidth className="mt-8">
            {t('forgot.back')}
          </ButtonLink>
        </div>
      ) : (
        <>
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
        </>
      )}
    </AuthLayout>
  );
}
