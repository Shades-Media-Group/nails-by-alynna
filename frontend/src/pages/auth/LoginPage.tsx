import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { homePathFor, useAuth } from '@/app/auth';
import { Alert } from '@/components/common/Alert';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button, Checkbox, PasswordField, TextField } from '@/components/ui';
import { ArrowForwardIcon, EmailIcon, KeyIcon } from '@/components/ui/icons';
import { safeNextPath } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage } from '@/lib/errors';
import { isEmail } from '@/lib/validation';
import { ApiError } from '@/services/api/client';
import { authApi } from '@/services/api/endpoints';
import { queries } from '@/services/queries';

/** Figma "App Prototype _email login". Works with browser/iCloud password managers. */
export default function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { lp } = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setUser } = useAuth();
  const next = safeNextPath(params.get('next'));
  const config = useQuery(queries.config());

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState(false);

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => {
      setUser(user);
      navigate(lp(next ?? homePathFor(user)), { replace: true });
    },
  });

  const emailError = touched && !isEmail(email) ? t('common:validation.invalid_email') : undefined;
  const passwordError = touched && !password ? t('common:validation.required') : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!isEmail(email) || !password) return;
    login.mutate({ email: email.trim(), password, remember });
  };

  const carry = next ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <AuthLayout
      back={`${lp('/login')}${carry}`}
      footer={
        <>
          {t('welcome.noAccount')}{' '}
          <Link to={`${lp('/signup')}${carry}`} className="font-bold text-rose-700 underline-offset-4 hover:underline">
            {t('welcome.signUp')}
          </Link>
        </>
      }
    >
      <h1 className="text-[1.875rem] font-extrabold uppercase leading-[0.95] tracking-[-0.03em]">
        <span className="block text-ink-900">{t('common:brand.tagline1')}</span>
        <span className="block text-rose-500">{t('common:brand.tagline2')}</span>
      </h1>
      <p className="mt-3 text-ink-600">{t('login.subtitle')}</p>

      <form className="mt-8 flex flex-col gap-4" method="post" action="#" noValidate onSubmit={onSubmit}>
        {login.isError ? (
          <Alert>
            {errorMessage(t, login.error)}
            {/* Accounts made with Google have no password until the owner sets one. */}
            {config.data?.auth.google && login.error instanceof ApiError && login.error.code === 'INVALID_CREDENTIALS' ? (
              <span className="mt-1 block">{t('login.googleHint')}</span>
            ) : null}
          </Alert>
        ) : null}
        <TextField
          label={t('login.email')}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t('login.emailPlaceholder')}
          icon={EmailIcon}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          required
        />
        <PasswordField
          label={t('login.password')}
          name="password"
          autoComplete="current-password"
          placeholder={t('login.passwordPlaceholder')}
          icon={KeyIcon}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
          required
        />
        <Link
          to={lp('/forgot-password')}
          className="-mt-1 self-end rounded-pill px-1 text-sm font-semibold text-ink-700 underline-offset-4 hover:underline"
        >
          {t('login.forgot')}
        </Link>
        <Checkbox label={t('login.remember')} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <Button type="submit" size="lg" fullWidth loading={login.isPending} trailingIcon={ArrowForwardIcon} className="mt-2">
          {t('login.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
