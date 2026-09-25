import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { homePathFor, useAuth } from '@/app/auth';
import { GoogleButton, GoogleTerms, OrDivider } from '@/components/auth/GoogleButton';
import { VerifyEmailStep } from '@/components/auth/VerifyEmailStep';
import { clearPendingCode, readPendingCode, savePendingCode } from '@/components/auth/pendingCode';
import { Alert } from '@/components/common/Alert';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { LegalLink } from '@/components/legal/LegalLink';
import { Button, Checkbox, PasswordField, TextField, toast } from '@/components/ui';
import { CallIcon, EmailIcon, KeyIcon, PersonOutlineIcon } from '@/components/ui/icons';
import { safeNextPath } from '@/i18n/routing';
import { useLocale } from '@/i18n/useLocale';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { isEmail, nameIssue, normalizePhone, passwordIssue } from '@/lib/validation';
import { ApiError, isApiError } from '@/services/api/client';
import { authApi, type PendingVerification } from '@/services/api/endpoints';
import { queries } from '@/services/queries';
import { useStudio } from '@/hooks/useStudio';
import { formatDateTime } from '@/lib/format';
import type { User } from '@/types/api';

type Field = 'name' | 'surname' | 'email' | 'phone' | 'password' | 'acceptTerms';

export default function SignupPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { lp, locale } = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setUser } = useAuth();
  const next = safeNextPath(params.get('next'));
  const config = useQuery(queries.config());
  const { timeZone } = useStudio();
  const inviteToken = params.get('invite');
  const invite = useQuery({
    queryKey: ['invite', inviteToken],
    queryFn: () => authApi.invite(inviteToken!),
    enabled: Boolean(inviteToken),
    retry: false,
    staleTime: Infinity,
  });

  const [form, setForm] = useState({ name: '', surname: '', email: '', phone: '', password: '' });
  // Prefill once from the invite: the studio already knows the name and phone.
  const [prefilled, setPrefilled] = useState(false);
  if (invite.data && !prefilled) {
    setPrefilled(true);
    setForm((f) => ({
      ...f,
      name: f.name || invite.data.name,
      surname: f.surname || invite.data.surname,
      phone: f.phone || (invite.data.phone ?? ''),
      email: f.email || (invite.data.email ?? ''),
    }));
  }
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [restored] = useState(() => readPendingCode('signup'));
  const [remember, setRemember] = useState(restored?.remember ?? true);
  const [touched, setTouched] = useState(false);
  // After the form: the emailed code confirms the address and opens the session.
  const [pending, setPending] = useState<Pick<PendingVerification, 'email' | 'resendAfterSec'> | null>(
    restored ? { email: restored.email, resendAfterSec: restored.resendAfterSec ?? 60 } : null,
  );

  // The address this tab just signed up with: submitting it again means "back to my code".
  const [registered, setRegistered] = useState<string | null>(restored?.email ?? null);
  const showCodeStep = (email: string, resendAfterSec = 60) => {
    setPending({ email, resendAfterSec });
    savePendingCode({ flow: 'signup', email, remember, resendAfterSec });
    window.scrollTo({ top: 0 });
  };

  const register = useMutation({
    mutationFn: authApi.register,
    onSuccess: (verification) => {
      setRegistered(verification.email);
      showCodeStep(verification.email, verification.resendAfterSec);
    },
    onError: (error, input) => {
      if (isApiError(error, 'EMAIL_TAKEN') && registered === input.email.trim().toLowerCase()) showCodeStep(registered);
    },
  });

  const onVerified = (user: User) => {
    clearPendingCode();
    setUser(user);
    toast.success(t('signup.welcomeToast', { name: user.name }));
    navigate(lp(next ?? homePathFor(user)), { replace: true });
  };

  const clientErrors: Partial<Record<Field, string>> = {};
  const nameCode = nameIssue(form.name);
  if (nameCode) clientErrors.name = t(`common:validation.${nameCode}`);
  const surnameCode = nameIssue(form.surname);
  if (surnameCode) clientErrors.surname = t(`common:validation.${surnameCode}`);
  if (!isEmail(form.email)) clientErrors.email = t('common:validation.invalid_email');
  if (!normalizePhone(form.phone)) clientErrors.phone = t('common:validation.invalid_phone');
  const pwCode = passwordIssue(form.password, form.email);
  if (pwCode) clientErrors.password = t(`common:validation.${pwCode}`);
  if (!acceptTerms) clientErrors.acceptTerms = t('common:validation.required');

  const serverErrors = fieldErrors(t, register.error) as Partial<Record<Field, string>>;
  const errors = touched ? { ...clientErrors, ...serverErrors } : serverErrors;
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (register.isError) register.reset();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(clientErrors).length > 0) return;
    register.mutate({
      name: form.name.trim(),
      surname: form.surname.trim(),
      email: form.email.trim(),
      phone: normalizePhone(form.phone) ?? form.phone,
      password: form.password,
      locale,
      remember,
      acceptTerms: true,
      ...(invite.data && inviteToken ? { invite: inviteToken } : {}),
    });
  };

  const showGlobalError =
    register.isError && !(register.error instanceof ApiError && Object.keys(register.error.fields).length > 0 && register.error.code === 'VALIDATION_ERROR');
  const carry = next ? `?next=${encodeURIComponent(next)}` : '';

  if (pending) {
    return (
      <AuthLayout back={`${lp('/login')}${carry}`}>
        <VerifyEmailStep
          email={pending.email}
          remember={remember}
          reason="signup"
          resendAfterSec={pending.resendAfterSec}
          sentAt={restored?.email === pending.email ? restored.at : undefined}
          onVerified={onVerified}
          onChangeEmail={() => {
            clearPendingCode();
            setPending(null);
            register.reset();
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      back={`${lp('/login')}${carry}`}
      footer={
        <>
          {t('signup.haveAccount')}{' '}
          <Link to={`${lp('/login/email')}${carry}`} className="font-bold text-rose-700 underline-offset-4 hover:underline">
            {t('signup.logIn')}
          </Link>
        </>
      }
    >
      <h1 className="text-h1 font-extrabold">{invite.data ? t('signup.inviteTitle', { name: invite.data.name }) : t('signup.title')}</h1>
      <p className="mt-2 text-ink-600">
        {invite.data
          ? invite.data.nextVisit
            ? t('signup.inviteVisit', { date: formatDateTime(invite.data.nextVisit, locale, timeZone) })
            : t('signup.inviteText')
          : t('signup.subtitle')}
      </p>
      {inviteToken && invite.isError ? (
        <Alert tone="warning" className="mt-4">
          {t('signup.inviteInvalid')}
        </Alert>
      ) : null}

      {config.data?.auth.google ? (
        <div className="mt-6 flex flex-col gap-3">
          <GoogleButton label={t('signup.google')} next={next} invite={invite.data ? inviteToken : null} />
          <GoogleTerms />
          <OrDivider label={t('signup.or')} />
        </div>
      ) : null}

      <form className="mt-6 flex flex-col gap-4" method="post" action="#" noValidate onSubmit={onSubmit}>
        {showGlobalError ? <Alert>{errorMessage(t, register.error)}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={t('signup.name')}
            name="given-name"
            autoComplete="given-name"
            icon={PersonOutlineIcon}
            value={form.name}
            onChange={set('name')}
            error={errors.name}
            required
          />
          <TextField
            label={t('signup.surname')}
            name="family-name"
            autoComplete="family-name"
            value={form.surname}
            onChange={set('surname')}
            error={errors.surname}
            required
          />
        </div>
        <TextField
          label={t('signup.email')}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t('login.emailPlaceholder')}
          icon={EmailIcon}
          value={form.email}
          onChange={set('email')}
          error={errors.email}
          required
        />
        <TextField
          label={t('signup.phone')}
          name="tel"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={t('signup.phonePlaceholder')}
          icon={CallIcon}
          value={form.phone}
          onChange={set('phone')}
          error={errors.phone}
          hint={t('signup.phoneHint')}
          required
        />
        <PasswordField
          label={t('signup.password')}
          name="new-password"
          autoComplete="new-password"
          icon={KeyIcon}
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint={t('signup.passwordHint')}
          required
        />
        <Checkbox
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          error={errors.acceptTerms}
          label={
            <Trans
              t={t}
              i18nKey="signup.terms"
              components={{
                terms: <LegalLink doc="terms" className="font-semibold text-ink-900" />,
                privacy: <LegalLink doc="privacy" className="font-semibold text-ink-900" />,
              }}
            />
          }
        />
        <Checkbox label={t('signup.remember')} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <Button type="submit" size="lg" fullWidth loading={register.isPending} className="mt-2">
          {t('signup.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
