import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { homePathFor, useAuth } from '@/app/auth';
import { GoogleButton, GoogleTerms, OrDivider } from '@/components/auth/GoogleButton';
import { Logo } from '@/components/brand/Logo';
import { Alert } from '@/components/common/Alert';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button, ButtonLink } from '@/components/ui';
import { ArrowForwardIcon } from '@/components/ui/icons';
import { safeNextPath } from '@/i18n/routing';
import { errorMessage } from '@/lib/errors';
import { useLocale } from '@/i18n/useLocale';
import { authApi } from '@/services/api/endpoints';
import { queries } from '@/services/queries';

const OAUTH_ERRORS = ['google', 'google_cancelled', 'google_conflict', 'google_disabled', 'account_disabled'];
const SHOW_DEMO_BUTTONS = false;

/** Figma "App Prototype _select_login": pick email or Google. */
export default function WelcomePage() {
  const { t } = useTranslation(['auth', 'common']);
  const { lp } = useLocale();
  const [params] = useSearchParams();
  const config = useQuery(queries.config());
  const next = safeNextPath(params.get('next'));
  const error = params.get('error');
  const carry = next ? `?next=${encodeURIComponent(next)}` : '';
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const demo = useMutation({
    mutationFn: authApi.demo,
    onSuccess: (user) => {
      setUser(user);
      navigate(lp(homePathFor(user)), { replace: true });
    },
  });
  // One-tap demo buttons are hidden for now; the client demo opens with demo / demo instead.
  const demoRoles = SHOW_DEMO_BUTTONS ? (config.data?.auth.demo ?? []) : [];

  return (
    <AuthLayout
      footer={{ text: t('welcome.noAccount'), action: t('welcome.signUp'), to: `${lp('/signup')}${carry}` }}
    >
      <Logo className="mx-auto w-[7.25rem] lg:hidden" />

      <h1 className="mt-8 text-[2rem] font-extrabold uppercase leading-[0.95] tracking-[-0.03em] sm:text-display">
        <span className="block text-ink-900">{t('common:brand.tagline1')}</span>
        <span className="block text-rose-500">{t('common:brand.tagline2')}</span>
      </h1>
      <p className="mt-3 max-w-xs text-ink-600">{t('welcome.subtitle')}</p>

      {error && OAUTH_ERRORS.includes(error) ? (
        <Alert className="mt-6">{t(`oauthErrors.${error}`)}</Alert>
      ) : null}

      <div className="mt-7 flex flex-col gap-3">
        <ButtonLink to={`${lp('/login/email')}${carry}`} variant="soft" trailingIcon={ArrowForwardIcon} fullWidth>
          {t('welcome.email')}
        </ButtonLink>

        {config.data?.auth.google ? (
          <>
            <OrDivider label={t('welcome.or')} />
            <GoogleButton label={t('welcome.google')} next={next} />
            <GoogleTerms className="mt-1" />
          </>
        ) : null}
      </div>

      {demoRoles.length > 0 ? (
        <section aria-labelledby="demo-title" className="mt-8 rounded-xl bg-peach-50 p-4">
          <h2 id="demo-title" className="text-sm font-bold text-peach-800">
            {t('demo.title')}
          </h2>
          <p className="mt-1 text-sm text-peach-800">{t('demo.text')}</p>
          {demo.isError ? <Alert className="mt-3">{errorMessage(t, demo.error)}</Alert> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {(['client', 'admin', 'administrator'] as const)
              .filter((role) => demoRoles.includes(role))
              .map((role) => (
                <Button
                  key={role}
                  size="sm"
                  variant="outline"
                  className="bg-white"
                  loading={demo.isPending && demo.variables === role}
                  disabled={demo.isPending}
                  onClick={() => demo.mutate(role)}
                >
                  {t(`demo.${role}`)}
                </Button>
              ))}
          </div>
        </section>
      ) : null}
    </AuthLayout>
  );
}
